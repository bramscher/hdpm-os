import { Suspense } from 'react';
import './maintenance-theme.css';
import BoardClient from './board-client';

export const metadata = {
  title: 'HDMS Maintenance — Live Board',
};

export default function MaintenanceBoardPage() {
  return (
    <Suspense>
      <BoardClient />
    </Suspense>
  );
}
