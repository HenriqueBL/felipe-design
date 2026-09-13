"use client";

import { useActionState } from "react";
import type { Currency, PlanPriceRow, PlanRow } from "@/types/database";
import { updatePriceAction, type ActionResult } from "@/app/[locale]/dashboard/actions";
import { formatMoney } from "@/lib/format";

interface PlanPriceFormLabels {
  updatePrice: string;
  currentPrice: string;
  noPriceSet: string;
  validFrom: string;
  saved: string;
  saveError: string;
}

interface PlanPriceFormProps {
  locale: string;
  plan: PlanRow;
  prices: PlanPriceRow[];
  labels: PlanPriceFormLabels;
}

export default function PlanPriceForm({ locale, plan, prices, labels }: PlanPriceFormProps) {
  const [state, formAction, isPending] = useActionState<ActionResult | null, FormData>(
    updatePriceAction.bind(null, locale),
    null,
  );

  const currencies: Currency[] = ["BRL", "USD"];

  return (
    <div className="plan-price-block">
      <table>
        <thead>
          <tr>
            <th>{labels.currentPrice}</th>
            <th>{labels.validFrom}</th>
          </tr>
        </thead>
        <tbody>
          {currencies.map((currency) => {
            const price = prices.find((p) => p.currency === currency && p.active);
            return (
              <tr key={currency}>
                <td>
                  {price
                    ? formatMoney(price.amount_cents, currency, locale)
                    : labels.noPriceSet}
                </td>
                <td>{price ? price.valid_from : "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <form action={formAction} className="inline-form">
        <input type="hidden" name="planId" value={plan.id} />
        <div className="form-group">
          <label htmlFor={"currency-" + plan.id}>Currency</label>
          <select id={"currency-" + plan.id} name="currency">
            <option value="BRL">BRL</option>
            <option value="USD">USD</option>
          </select>
        </div>
        <div className="form-group">
          <label htmlFor={"amount-" + plan.id}>Cents</label>
          <input
            id={"amount-" + plan.id}
            name="amountCents"
            type="number"
            min={0}
            max={10000000}
            required
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={isPending}>
          {labels.updatePrice}
        </button>
      </form>

      {state?.success === true && <p className="form-status ok">{labels.saved}</p>}
      {state?.success === false && (
        <p className="form-status err">{state.message ?? labels.saveError}</p>
      )}
    </div>
  );
}
