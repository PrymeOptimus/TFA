"use client";

import { createContext, useContext } from "react";

export interface HouseholdContextValue {
  householdId: string;
  householdName: string;
  timezone: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
}

const HouseholdContext = createContext<HouseholdContextValue | null>(null);

export function HouseholdProvider({ value, children }: { value: HouseholdContextValue; children: React.ReactNode }) {
  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

export function useHousehold(): HouseholdContextValue {
  const ctx = useContext(HouseholdContext);
  if (!ctx) throw new Error("useHousehold must be used within a HouseholdProvider (i.e. under /dashboard)");
  return ctx;
}
