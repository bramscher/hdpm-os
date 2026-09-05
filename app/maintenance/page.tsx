import { redirect } from 'next/navigation';

/** /maintenance used to 404 — land on the board, whose default view is the Dashboard. */
export default function MaintenancePage() {
  redirect('/maintenance/board');
}
