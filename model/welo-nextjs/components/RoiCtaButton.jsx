
import Link from "next/link";

export function RoiCtaLink() {
  return (
    <Link href="/roi-calculator" className="roi-cta">
      Calculate your absenteeism cost
      <style>{`
        .roi-cta {
          display:inline-block; background:#BB3D2E; color:#fff; text-decoration:none;
          font-weight:600; font-size:15px; padding:14px 22px; border-radius:11px;
          font-family:'Inter',-apple-system,sans-serif; transition:background .15s;
        }
        .roi-cta:hover { background:#9A3124; }
      `}</style>
    </Link>
  );
}

// Pattern B - programmatic redirect from an onClick handler, if your button
// already runs other logic on click. Requires "use client" at the top of the
// file where this is used.
//
//   "use client";
//   import { useRouter } from "next/navigation";
//
//   const router = useRouter();
//   <button onClick={() => router.push("/roi-calculator")}>
//     Calculate your absenteeism cost
//   </button>
