import type { Clock, Employee, Sheet } from "./model";
export type TimekeepingBoot = {
  employee: Employee;
  isAdmin: boolean;
  canReview: boolean;
  sheet: Sheet | null;
  clock: Clock;
  today: string;
  employees: Employee[];
};
export type TimekeepingApi = <T>(
  path?: string,
  body?: Record<string, unknown>,
) => Promise<T>;
