import { Buffer } from 'node:buffer';
import { jsPDF as JsPDF } from 'jspdf';

interface WaiverPdfInput {
  memberFirstName: string;
  memberLastName: string;
  signedByName: string;
  signedByRelationship: string | null;
  signedAt: Date;
  waiverTemplateName: string;
  renderedContent: string;
  signatureDataUrl: string;
  planName?: string;
  planPrice?: number;
  planFrequency?: string;
}

/**
 * Generate a PDF buffer for a signed waiver.
 */
export async function generateWaiverPdfBuffer(input: WaiverPdfInput): Promise<Buffer> {
  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  // Title
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(input.waiverTemplateName, margin, y);
  y += 10;

  // Member info
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`Member: ${input.memberFirstName} ${input.memberLastName}`, margin, y);
  y += 6;

  if (input.planName) {
    doc.text(`Plan: ${input.planName}`, margin, y);
    y += 6;
  }

  if (input.planPrice !== undefined) {
    const priceStr = input.planPrice === 0 ? 'Free' : `$${input.planPrice.toFixed(2)}`;
    const freqStr = input.planFrequency ? ` / ${input.planFrequency}` : '';
    doc.text(`Price: ${priceStr}${freqStr}`, margin, y);
    y += 6;
  }

  doc.text(`Date: ${input.signedAt.toLocaleDateString('en-US')}`, margin, y);
  y += 10;

  // Separator
  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  // Waiver content
  doc.setFontSize(10);
  const lines = doc.splitTextToSize(input.renderedContent, maxWidth);
  for (const line of lines as string[]) {
    if (y > doc.internal.pageSize.getHeight() - 40) {
      doc.addPage();
      y = margin;
    }
    doc.text(line, margin, y);
    y += 5;
  }

  y += 10;

  // Signature section
  if (y > doc.internal.pageSize.getHeight() - 60) {
    doc.addPage();
    y = margin;
  }

  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Signature', margin, y);
  y += 8;

  // Embed signature image if available
  if (input.signatureDataUrl && input.signatureDataUrl.startsWith('data:image')) {
    try {
      doc.addImage(input.signatureDataUrl, 'PNG', margin, y, 60, 20);
      y += 24;
    }
    catch {
      doc.text('[Signature on file]', margin, y);
      y += 6;
    }
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Signed by: ${input.signedByName}`, margin, y);
  y += 5;

  if (input.signedByRelationship) {
    doc.text(`Relationship: ${input.signedByRelationship}`, margin, y);
    y += 5;
  }

  doc.text(`Date signed: ${input.signedAt.toLocaleString('en-US')}`, margin, y);

  // Convert to Buffer
  const arrayBuffer = doc.output('arraybuffer');
  return Buffer.from(arrayBuffer);
}

/**
 * Generate a standardized PDF filename for a signed waiver.
 */
export function generatePdfFilename(lastName: string, firstName: string): string {
  const safe = (s: string) => s.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const dateStr = new Date().toISOString().split('T')[0] ?? 'undated';
  return `waiver_${safe(lastName)}_${safe(firstName)}_${dateStr}.pdf`;
}
