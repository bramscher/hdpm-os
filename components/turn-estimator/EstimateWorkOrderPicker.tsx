'use client';
import { useState } from 'react';
import Link from 'next/link';

export default function EstimateWorkOrderPicker() {
  const [search, setSearch] = useState('');
  const [orders, setOrders] = useState<{id:string; property_name:string; unit_name:string|null; wo_number:string|null; description:string}[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function find(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch(`/api/work-orders?search=${encodeURIComponent(search)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not find work orders');
      setOrders(data.workOrders || []);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="mb-5 rounded-xl border border-sand-200 bg-white p-4">
    <h2 className="font-semibold text-charcoal-900">Connect a work order first</h2>
    <p className="mt-1 text-sm text-charcoal-500">For scheduled work, choose its work order before editing the template. You can also prepare a standalone estimate below.</p>
    <form onSubmit={find} className="mt-3 flex flex-wrap gap-2"><input aria-label="Find work order for estimate" placeholder="Property or work-order number" className="min-h-11 flex-1 rounded-lg border border-sand-200 p-3 text-sm" value={search} onChange={e=>setSearch(e.target.value)}/><button className="min-h-11 rounded-lg border border-sand-200 px-4 text-sm" disabled={busy}>{busy?'Searching…':'Find work order'}</button></form>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {orders && <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">{!orders.length && <p className="text-sm text-charcoal-500">No matching work orders.</p>}{orders.map(order=><Link key={order.id} href={`/turn-estimator/estimates/new?from_wo=${order.id}`} className="block rounded-lg border border-sand-200 p-3 text-sm hover:bg-sand-50"><strong>{order.property_name}{order.unit_name && ` · ${order.unit_name}`} · WO {order.wo_number}</strong><p className="mt-1 line-clamp-2 text-charcoal-500">{order.description}</p></Link>)}</div>}
  </section>;
}
