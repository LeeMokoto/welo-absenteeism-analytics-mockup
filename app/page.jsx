import Link from "next/link";

// The repo's primary home is the static absenteeism dashboard (root index.html),
// deployed separately. This Next app exists for the /sick-leave sibling, so the
// root route just points there.
export default function Home() {
  return (
    <main className="page" style={{ paddingTop: 60 }}>
      <h1 style={{ fontSize: 26 }}>Welo</h1>
      <p style={{ marginTop: 12 }}>
        <Link href="/sick-leave">Open the Sick Leave Intelligence dashboard</Link>
      </p>
    </main>
  );
}
