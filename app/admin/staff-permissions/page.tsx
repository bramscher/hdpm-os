import { redirect } from 'next/navigation';

// Staff permissions now lives in Admin → User settings (abilities tab).
export default function Page() {
  redirect('/admin/user-settings?tab=abilities');
}
