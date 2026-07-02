import '../../maintenance-theme.css';
import DetailClient from './detail-client';

export const metadata = {
  title: 'Work Order — HDMS Maintenance',
};

export default async function WorkOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DetailClient workOrderId={id} />;
}
