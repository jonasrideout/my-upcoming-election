// Server-side proxy to Google's Civic Information API (voterinfo).
// Keeps the API key off the browser and returns a trimmed, stable shape
// that later steps (voting-record cards) can build on.

import { NextRequest, NextResponse } from "next/server";

const VOTERINFO_URL = "https://www.googleapis.com/civicinfo/v2/voterinfo";

export type Candidate = {
  name: string;
  party?: string;
  candidateUrl?: string;
};

export type Contest = {
  // Stable key for this race. Prefer the Open Civic Data district ID when Google
  // provides one; it's what we'll use later to match voting records.
  key: string;
  kind: "candidate" | "measure";
  office?: string;
  districtName?: string;
  districtScope?: string;
  ocdId?: string;
  candidates: Candidate[];
  // Ballot measure fields
  measureTitle?: string;
  measureSubtitle?: string;
  measureText?: string;
  measureUrl?: string;
};

export type BallotResponse = {
  election: { id: string; name: string; electionDay: string } | null;
  normalizedAddress: string | null;
  contests: Contest[];
  pollingLocations: { name?: string; address: string; hours?: string }[];
  raw?: unknown;
};

const ELECTIONS_URL = "https://www.googleapis.com/civicinfo/v2/elections";

function friendlyError(msg: string): string {
  if (/parse address/i.test(msg)) return "We couldn't read that address. Try including city and state.";
  if (/API key|permission|disabled/i.test(msg))
    return "The API key isn't working. Check that the Civic Information API is enabled for it.";
  if (/election unknown|no information|no contests/i.test(msg))
    return "No upcoming election data found for that address yet.";
  return "Couldn't look up that address.";
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function formatAddress(a: any): string {
  if (!a) return "";
  return [a.locationName, a.line1, a.line2, a.line3, a.city, a.state, a.zip]
    .filter(Boolean)
    .join(", ");
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address")?.trim();
  const includeRaw = req.nextUrl.searchParams.get("raw") === "1";

  if (!address) {
    return NextResponse.json({ error: "Please enter a street address." }, { status: 400 });
  }

  const key = process.env.GOOGLE_CIVIC_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "Server is missing GOOGLE_CIVIC_API_KEY. Add it to .env.local or Vercel settings." },
      { status: 500 }
    );
  }

  // 1. Ask Google which elections it currently has data for.
  //    ID 2000 is Google's permanent test election, so skip it.
  let upcoming: { id: string; name: string; electionDay: string }[] = [];
  try {
    const er = await fetch(`${ELECTIONS_URL}?key=${encodeURIComponent(key)}`, { cache: "no-store" });
    const ej = await er.json();
    if (!er.ok) {
      const msg: string = ej?.error?.message ?? "";
      return NextResponse.json({ error: friendlyError(msg), detail: msg }, { status: er.status });
    }
    const today = new Date().toISOString().slice(0, 10);
    upcoming = (ej.elections ?? [])
      .filter((e: any) => e.id !== "2000" && e.electionDay >= today)
      .sort((a: any, b: any) => a.electionDay.localeCompare(b.electionDay));
  } catch {
    return NextResponse.json({ error: "Network error reaching Google." }, { status: 502 });
  }

  // 2. Try the default lookup first, then each upcoming election by ID,
  //    and keep the first one that actually returns races for this address.
  const attempts: (string | null)[] = [null, ...upcoming.map((e) => e.id)];
  const tried: { electionId: string | null; detail: string }[] = [];
  let data: any = null;

  for (const electionId of attempts) {
    const url = new URL(VOTERINFO_URL);
    url.searchParams.set("address", address);
    url.searchParams.set("key", key);
    if (electionId) url.searchParams.set("electionId", electionId);
    try {
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      if (res.ok && (json.contests?.length ?? 0) > 0) {
        data = json;
        break;
      }
      const msg: string = res.ok ? "Election found but no contests returned" : json?.error?.message ?? "";
      tried.push({ electionId, detail: msg });
      // A bad address or bad key won't get better with another election ID.
      if (/parse address|API key|permission|disabled/i.test(msg)) break;
      if (res.ok && !data) data = json; // keep as fallback (election info, no contests)
    } catch {
      tried.push({ electionId, detail: "Network error" });
    }
  }

  if (!data) {
    const lastDetail = tried[tried.length - 1]?.detail ?? "";
    return NextResponse.json(
      { error: friendlyError(lastDetail), detail: lastDetail, availableElections: upcoming, tried },
      { status: 404 }
    );
  }

  const contests: Contest[] = (data.contests ?? []).map((c: any, i: number): Contest => {
    const isMeasure = c.type === "Referendum" || !!c.referendumTitle;
    const ocdId: string | undefined = c.district?.id;
    const label = isMeasure ? c.referendumTitle ?? `measure-${i}` : c.office ?? `contest-${i}`;
    return {
      key: `${ocdId ?? "no-ocd"}::${slug(label)}`,
      kind: isMeasure ? "measure" : "candidate",
      office: c.office,
      districtName: c.district?.name,
      districtScope: c.district?.scope,
      ocdId,
      candidates: (c.candidates ?? []).map((p: any) => ({
        name: p.name,
        party: p.party,
        candidateUrl: p.candidateUrl,
      })),
      measureTitle: c.referendumTitle,
      measureSubtitle: c.referendumSubtitle,
      measureText: c.referendumText,
      measureUrl: c.referendumUrl,
    };
  });

  const body: BallotResponse = {
    election: data.election
      ? { id: data.election.id, name: data.election.name, electionDay: data.election.electionDay }
      : null,
    normalizedAddress: data.normalizedInput ? formatAddress(data.normalizedInput) : null,
    contests,
    pollingLocations: (data.pollingLocations ?? []).slice(0, 3).map((p: any) => ({
      name: p.address?.locationName,
      address: formatAddress(p.address),
      hours: p.pollingHours,
    })),
    ...(includeRaw ? { raw: data } : {}),
  };

  return NextResponse.json(body);
}
