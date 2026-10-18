"use client";

import { useState, type FormEvent } from "react";
import type { BallotResponse, Contest } from "./api/ballot/route";

export default function Home() {
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ballot, setBallot] = useState<BallotResponse | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!address.trim()) return;
    setLoading(true);
    setError(null);
    setBallot(null);
    try {
      const res = await fetch(`/api/ballot?raw=1&address=${encodeURIComponent(address)}`);
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Something went wrong.");
      else setBallot(data);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }

  const races = ballot?.contests.filter((c) => c.kind === "candidate") ?? [];
  const measures = ballot?.contests.filter((c) => c.kind === "measure") ?? [];

  return (
    <main>
      <h1>What's on my ballot?</h1>

      <form onSubmit={onSubmit}>
        <label htmlFor="address">Enter your street address</label>
        <div className="row">
          <input
            id="address"
            type="text"
            autoComplete="street-address"
            placeholder="123 Main St, Yonkers, NY"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <button type="submit" disabled={loading}>
            {loading ? "Looking…" : "Show ballot"}
          </button>
        </div>
        <span className="hint">Apt # not required</span>
      </form>

      {error && <p className="error">{error}</p>}

      {ballot && (
        <>
          <p className="meta">
            {ballot.election?.name ?? "Upcoming election"}
            {ballot.election?.electionDay && ` · ${ballot.election.electionDay}`}
            {ballot.normalizedAddress && <><br />{ballot.normalizedAddress}</>}
          </p>

          {ballot.contests.length === 0 && (
            <p>No races returned for this address yet. Ballot data may still be loading for this area.</p>
          )}

          {races.length > 0 && <div className="section-title">Races ({races.length})</div>}
          {races.map((c) => <RaceCard key={c.key} c={c} />)}

          {measures.length > 0 && <div className="section-title">Ballot measures ({measures.length})</div>}
          {measures.map((c) => <MeasureCard key={c.key} c={c} />)}

          <details>
            <summary>Raw API response (for testing)</summary>
            <pre>{JSON.stringify(ballot.raw, null, 2)}</pre>
          </details>
        </>
      )}
    </main>
  );
}

function RaceCard({ c }: { c: Contest }) {
  return (
    <div className="contest">
      <h3>{c.office}</h3>
      {c.districtName && <div className="district">{c.districtName}</div>}
      <ul>
        {c.candidates.map((p) => (
          <li key={p.name}>
            <span>{p.name}</span>
            {p.party && <span className="party">{p.party}</span>}
          </li>
        ))}
      </ul>
      <div className="key">{c.key}</div>
    </div>
  );
}

function MeasureCard({ c }: { c: Contest }) {
  return (
    <div className="contest">
      <h3>{c.measureTitle}</h3>
      {c.measureSubtitle && <div className="district">{c.measureSubtitle}</div>}
      <div className="key">{c.key}</div>
    </div>
  );
}
