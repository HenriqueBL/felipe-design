import type { OrderDisplayState } from "@/domain/checkout";

interface OrderStepsLabels {
  stepPayment: string;
  stepPhotos: string;
  stepQueue: string;
  stepProgress: string;
  stepDelivery: string;
}

function currentIndexFor(state: OrderDisplayState): number {
  if (state === "awaiting_payment") return 0;
  if (state === "awaiting_photos") return 1;
  if (state === "in_queue") return 2;
  if (state === "in_progress") return 3;
  if (state === "completed") return 4;
  return -1;
}

export default function OrderSteps({
  state,
  labels,
}: {
  state: OrderDisplayState;
  labels: OrderStepsLabels;
}) {
  const steps = [
    labels.stepPayment,
    labels.stepPhotos,
    labels.stepQueue,
    labels.stepProgress,
    labels.stepDelivery,
  ];
  const currentIndex = currentIndexFor(state);

  return (
    <ul className="steps">
      {steps.map((label, i) => {
        const className = i < currentIndex ? "done" : i === currentIndex ? "current" : "";
        return (
          <li key={i} className={className}>
            {label}
          </li>
        );
      })}
    </ul>
  );
}
