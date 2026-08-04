/**
 * Owner Report API
 *
 * GET  /api/reports/owner?q=search    → Search owner names
 * POST /api/reports/owner             → Generate report (JSON, PDF, or Excel)
 *
 * POST body:
 *   { owner_name: string, format: "json" | "pdf" | "excel" }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { searchOwners, buildOwnerReport } from '@/lib/owner-report';
import { generateOwnerReportPdf } from '@/lib/owner-report-pdf';
import { generateOwnerReportExcel } from '@/lib/owner-report-excel';

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q') || '';

    const owners = await searchOwners(query);
    return NextResponse.json({ owners });
  } catch (error) {
    console.error('[Owner Report] Search error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Search failed' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { owner_name, format = 'json' } = body as {
      owner_name: string;
      format?: 'json' | 'pdf' | 'excel';
    };

    if (!owner_name) {
      return NextResponse.json(
        { error: 'owner_name is required' },
        { status: 400 }
      );
    }

    console.log(`[Owner Report] Building report for "${owner_name}" (format: ${format})`);
    const report = await buildOwnerReport(owner_name);

    if (report.properties.length === 0) {
      return NextResponse.json(
        { error: `No properties found for owner "${owner_name}"` },
        { status: 404 }
      );
    }

    if (format === 'pdf') {
      const pdfBuffer = generateOwnerReportPdf(report);
      const fileName = `Owner_Report_${owner_name.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;

      return new Response(new Uint8Array(pdfBuffer), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${fileName}"`,
        },
      });
    }

    if (format === 'excel') {
      const excelBuffer = generateOwnerReportExcel(report);
      const fileName = `Owner_Report_${owner_name.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;

      return new Response(new Uint8Array(excelBuffer), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${fileName}"`,
        },
      });
    }

    // Default: JSON
    return NextResponse.json(report);
  } catch (error) {
    console.error('[Owner Report] Generation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Report generation failed' },
      { status: 500 }
    );
  }
}
