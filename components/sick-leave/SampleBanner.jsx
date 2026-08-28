// Persistent, non-dismissible sample-data banner. Always visible at the top of
// the page (compliance requirement 9.1).
export default function SampleBanner() {
  return (
    <div className="banner sample" role="note">
      <span className="mono">
        Sample data only. All figures are synthetic. No client data is present in this build.
      </span>
    </div>
  );
}
