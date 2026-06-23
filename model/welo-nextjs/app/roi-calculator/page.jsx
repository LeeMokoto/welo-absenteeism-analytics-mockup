import RoiCalculator from "../../components/RoiCalculator";

export const metadata = {
  title: "Absenteeism ROI Calculator | Welo Health",
  description:
    "Estimate the annual cost of unplanned health absence across your workforce and what a modest reduction is worth.",
};

export default function RoiCalculatorPage() {
  return (
    <main>
      <RoiCalculator />
    </main>
  );
}
