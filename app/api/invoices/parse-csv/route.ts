import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import Papa from 'papaparse';
import { WorkOrderRow } from '@/lib/invoices';

// Column name mappings from AppFolio CSV export headers to our fields
const COLUMN_MAP: Record<string, keyof WorkOrderRow> = {
  'work order #': 'wo_number',
  'work order number': 'wo_number',
  'wo #': 'wo_number',
  'wo number': 'wo_number',
  'reference': 'wo_number',
  'property': 'property_name',
  'property name': 'property_name',
  'address': 'property_address',
  'property address': 'property_address',
  'unit': 'unit',
  'description': 'description',
  'work description': 'description',
  'date completed': 'completed_date',
  'completed date': 'completed_date',
  'completed': 'completed_date',
  'category': 'category',
  'type': 'category',
  'assigned to': 'assigned_to',
  'assigned': 'assigned_to',
  'technician': 'assigned_to',
};

function normalizeColumnName(header: string): string {
  return header.toLowerCase().trim().replace(/[_\-]+/g, ' ');
}

function mapRow(rawRow: Record<string, string>): WorkOrderRow {
  const mapped: Record<string, string> = {
    wo_number: '',
    property_name: '',
    property_address: '',
    unit: '',
    description: '',
    completed_date: '',
    category: '',
    assigned_to: '',
  };

  for (const [rawKey, value] of Object.entries(rawRow)) {
    const normalized = normalizeColumnName(rawKey);
    const mappedKey = COLUMN_MAP[normalized];
    if (mappedKey) {
      mapped[mappedKey] = (value || '').trim();
    }
    // Keep all raw columns too
    mapped[rawKey] = (value || '').trim();
  }

  return mapped as unknown as WorkOrderRow;
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in with your company Microsoft account.' },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!file.name.endsWith('.csv')) {
      return NextResponse.json({ error: 'File must be a CSV' }, { status: 400 });
    }

    const csvText = await file.text();

    const result = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim(),
    });

    if (result.errors.length > 0) {
      const errorMessages = result.errors.slice(0, 3).map(e => e.message).join('; ');
      return NextResponse.json(
        { error: `CSV parsing errors: ${errorMessages}` },
        { status: 400 }
      );
    }

    if (result.data.length === 0) {
      return NextResponse.json({ error: 'CSV file is empty' }, { status: 400 });
    }

    const rows = result.data.map(mapRow);
    const headers = result.meta.fields || [];

    return NextResponse.json({ rows, headers, totalRows: rows.length });
  } catch (error) {
    console.error('CSV parse error:', error);
    const message = error instanceof Error ? error.message : 'Failed to parse CSV';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
