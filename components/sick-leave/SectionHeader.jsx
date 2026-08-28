export default function SectionHeader({ title, sub }) {
  return (
    <div className="section-header">
      <h2>{title}</h2>
      {sub ? <span className="section-sub">{sub}</span> : null}
    </div>
  );
}
