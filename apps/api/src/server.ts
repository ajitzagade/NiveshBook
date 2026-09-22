import Fastify from "fastify";
import { absoluteReturnPercent, totalCurrentValue } from "@niveshbook/core";
import type { Portfolio } from "@niveshbook/types";

const app = Fastify({ logger: true });

app.get("/health", async () => ({ status: "ok" }));

app.get("/portfolios/demo", async () => {
  const portfolio: Portfolio = {
    id: "demo",
    ownerId: "demo-user",
    name: "Demo Portfolio",
    investments: [
      {
        id: "inv-1",
        name: "Nifty 50 Index Fund",
        category: "mutual_fund",
        investedValue: { amount: 100000, currency: "INR" },
        currentValue: { amount: 118500, currency: "INR" },
        purchaseDate: "2024-01-15",
      },
    ],
  };

  return {
    portfolio,
    currentValue: totalCurrentValue(portfolio),
    returnPercent: absoluteReturnPercent(portfolio),
  };
});

const port = Number(process.env.PORT ?? 4000);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
