export interface Money {
  amount: number;
  currency: string;
}

export interface Investment {
  id: string;
  name: string;
  category: "equity" | "mutual_fund" | "fixed_deposit" | "bond" | "other";
  investedValue: Money;
  currentValue: Money;
  purchaseDate: string;
}

export interface Portfolio {
  id: string;
  ownerId: string;
  name: string;
  investments: Investment[];
}
