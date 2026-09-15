/** Craig manages payroll and approvals but does not record employee time. */
export function recordsEmployeeTime(staffPerson: string): boolean {
  return staffPerson.trim().toLowerCase() !== "craig";
}
