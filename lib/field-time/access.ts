// Who reviews field time against billing besides an admin (Craig, Oct 15: Brody now, the Maintenance
// Coordinator Assistant once hired; add their email here). A reviewer gets every tech's job and parts
// minutes and the "field time vs billing" items in Daily Billing Review. Drive, inspection and unlabeled
// time, and the full field day, stay with an admin or the tech themselves.
const FIELD_REVIEWERS = ['brody@highdesertpm.com'];

export const isFieldReviewer = (email: string | null | undefined) => !!email && FIELD_REVIEWERS.includes(email.trim().toLowerCase());
