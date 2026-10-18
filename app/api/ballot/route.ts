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

  const url = new URL(VOTERINFO_URL);
  url.searchParams.set("address", address);
  url.searchParams.set("key", key);
  // No electionId → Google returns the next upcoming election for this address.

  let data: any;
  try {
    const res = await fetch(url, { cache: "no-store" });
    data = await res.json();
    if (!res.ok) {
      const msg: string = data?.error?.message ?? "";
      let friendly = "Couldn't look up that address.";
      if (/parse address/i.test(msg)) friendly = "We couldn't read that address. Try including city and state.";
      else if (/election unknown|no information/i.test(msg))
        friendly = "No upcoming election data found for that address yet.";
      else if (/API key|permission|disabled/i.test(msg))
        friendly = "The API key isn't working. Check that the Civic Information API is enabled for it.";
      return NextResponse.json({ error: friendly, detail: msg }, { status: res.status });
    }
  } catch (e) {
    return NextResponse.json({ error: "Network error reaching Google." }, { status: 502 });
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
