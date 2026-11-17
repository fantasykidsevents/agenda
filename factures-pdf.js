/* Export A4 Fantasy Kids Events : la mise en page ne dépend pas de l'impression HTML. */
(() => {
  'use strict';

  let jsPdfLoader;
  const COLORS = {
    cyan: [0, 181, 235], purple: [164, 22, 234], pink: [249, 54, 187],
    ink: [40, 33, 54], muted: [105, 94, 119], light: [247, 243, 253],
    ice: [237, 250, 255], border: [225, 215, 239], white: [255, 255, 255]
  };

  const value = input => String(input ?? '').replace(/\r\n?/g, '\n').trim();
  const amount = input => Number(input || 0).toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const date = input => input ? String(input).slice(0, 10).split('-').reverse().join('/') : 'À préciser';

  async function loadJsPdf() {
    if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
    if (!jsPdfLoader) jsPdfLoader = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js';
      script.async = true;
      script.onload = () => window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(Error('Bibliothèque PDF indisponible.'));
      script.onerror = () => reject(Error('La connexion est nécessaire pour préparer le PDF.'));
      document.head.append(script);
    }).catch(error => { jsPdfLoader = null; throw error; });
    return jsPdfLoader;
  }

  async function loadLogo() {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = new URL('logo.png', document.baseURI).href;
    });
  }

  function sparkle(pdf, x, y, radius, color = COLORS.white) {
    pdf.setFillColor(...color);
    pdf.lines([
      [radius * .2, radius * .8], [radius * .2, radius * .2],
      [radius * .8, radius * .2], [-radius * .8, radius * .2],
      [-radius * .2, radius * .8], [-radius * .2, -radius * .8],
      [-radius * .8, -radius * .2], [radius * .8, -radius * .2]
    ], x, y - radius, [1, 1], 'F', true);
  }

  function text(pdf, label, x, y, size = 10, color = COLORS.ink, weight = 'normal', options = {}) {
    pdf.setFont('helvetica', weight);
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    pdf.text(String(label), x, y, options);
  }

  function wrap(pdf, content, width, size = 10, weight = 'normal') {
    pdf.setFont('helvetica', weight);
    pdf.setFontSize(size);
    return value(content).split('\n').flatMap(line => pdf.splitTextToSize(line || ' ', width));
  }

  function header(pdf, kind, number, logo, continuation = false, cancelled = false) {
    pdf.setFillColor(...COLORS.cyan);
    pdf.rect(0, 0, 210, continuation ? 35 : 52, 'F');
    pdf.setFillColor(...COLORS.purple);
    pdf.ellipse(22, continuation ? -3 : 13, 88, continuation ? 28 : 40, 'F');
    pdf.setFillColor(...COLORS.pink);
    pdf.rect(0, continuation ? 34 : 51, 210, 1.4, 'F');
    text(pdf, cancelled ? 'DEVIS ANNULÉ' : kind === 'devis' ? 'DEVIS' : 'FACTURE', 19, continuation ? 19 : 24, continuation ? 18 : 29, COLORS.white, 'bold');
    if (!continuation) {
      text(pdf, 'FANTASY KIDS EVENTS', 19, 34, 9, COLORS.white, 'bold');
      sparkle(pdf, 67, 20, 4.5);
      sparkle(pdf, 73, 31, 2.5);
    }
    if (logo) {
      pdf.setFillColor(...COLORS.white);
      pdf.roundedRect(145, continuation ? 3.5 : 7, 52, continuation ? 27 : 35, 5, 5, 'F');
      pdf.addImage(logo, 'PNG', 150, continuation ? 5 : 9, 43, 27);
    } else {
      text(pdf, 'Fantasy Kids Events', 190, 22, 12, COLORS.white, 'bold', { align: 'right' });
    }
    if (!continuation) {
      text(pdf, number || 'À numéroter', 191, 48, 9, COLORS.white, 'bold', { align: 'right' });
    } else {
      text(pdf, `Suite du document ${number || 'en préparation'}`, 19, 30, 8.5, COLORS.white);
    }
  }

  function footer(pdf, data, page) {
    const issuer = data.emetteur || {};
    pdf.setFillColor(...COLORS.light);
    pdf.rect(0, 250, 210, 47, 'F');
    pdf.setFillColor(...COLORS.cyan);
    pdf.rect(17, 249.5, 176, 1.1, 'F');
    text(pdf, issuer.nom || 'Fantasy Kids Events', 19, 260, 10, COLORS.ink, 'bold');
    const issuerDetails = wrap(pdf, [issuer.adresse, issuer.contact].filter(Boolean).join('\n'), 84, 8.5);
    issuerDetails.slice(0, 5).forEach((line, i) => text(pdf, line, 19, 267 + i * 4.3, 8.5, COLORS.muted));
    text(pdf, 'INFORMATIONS DE FACTURATION', 111, 260, 8, COLORS.purple, 'bold');
    text(pdf, 'Entreprise / TVA : ' + value(issuer.tva || '-'), 111, 267, 8.5, COLORS.ink);
    text(pdf, 'IBAN : ' + value(issuer.iban || '-'), 111, 272.3, 8.5, COLORS.ink);
    const regime = wrap(pdf, data.regime_tva || '', 80, 7.3);
    regime.slice(0, 3).forEach((line, i) => text(pdf, line, 111, 279 + i * 3.6, 7.3, COLORS.muted));
    pdf.setFillColor(...COLORS.purple);
    pdf.rect(0, 292, 210, 5, 'F');
    text(pdf, 'De la magie plein les yeux', 19, 295.4, 7, COLORS.white);
    text(pdf, `Page ${page}`, 191, 295.4, 7, COLORS.white, 'normal', { align: 'right' });
  }

  function customer(pdf, data, number, kind) {
    const client = data.client || {};
    const addr = wrap(pdf, client.adresse || 'Adresse du client', 104, 10);
    const name = wrap(pdf, client.nom || 'Nom du client', 104, 12.4, 'bold');
    const vat = client.tva ? wrap(pdf, 'TVA : ' + client.tva, 104, 9) : [];
    const bodyHeight = Math.max(33, 12 + name.length * 5.4 + addr.length * 4.9 + vat.length * 4.9);
    const y = 61, cardHeight = bodyHeight + 10;
    pdf.setFillColor(...COLORS.light);
    pdf.roundedRect(17, y, 117, cardHeight, 4, 4, 'F');
    pdf.setFillColor(...COLORS.ice);
    pdf.roundedRect(140, y, 53, cardHeight, 4, 4, 'F');
    text(pdf, 'À L’ATTENTION DE', 22, y + 8, 8.2, COLORS.cyan, 'bold');
    let cursor = y + 16;
    name.forEach(line => { text(pdf, line, 22, cursor, 12.4, COLORS.ink, 'bold'); cursor += 5.4; });
    cursor += 2;
    addr.forEach(line => { text(pdf, line, 22, cursor, 10, COLORS.muted); cursor += 4.9; });
    if (vat.length) { cursor += 1.5; vat.forEach(line => { text(pdf, line, 22, cursor, 9, COLORS.ink); cursor += 4.9; }); }
    text(pdf, kind === 'devis' ? 'N° DE DEVIS' : 'N° DE FACTURE', 145, y + 8, 7.5, COLORS.cyan, 'bold');
    const numberLines = wrap(pdf, number || 'À numéroter', 43, 10.5, 'bold');
    numberLines.forEach((line, i) => text(pdf, line, 145, y + 15 + i * 5, 10.5, COLORS.ink, 'bold'));
    text(pdf, 'DATE D’ÉMISSION', 145, y + cardHeight - 13, 7.5, COLORS.cyan, 'bold');
    text(pdf, date(data.date_emission || new Date().toISOString().slice(0, 10)), 145, y + cardHeight - 6, 10, COLORS.ink);
    const afterCard = y + cardHeight;
    if (data.date_prestation) {
      text(pdf, `Date de la prestation : ${date(data.date_prestation)}`, 19, afterCard + 6, 8.5, COLORS.muted);
    }
    return afterCard + 13;
  }

  function tableTitle(pdf, y) {
    text(pdf, 'DÉTAIL DE LA PRESTATION', 19, y, 11.3, COLORS.purple, 'bold');
    pdf.setDrawColor(...COLORS.border);
    pdf.setLineWidth(.4);
    pdf.line(83, y - 1, 191, y - 1);
    y += 6;
    pdf.setFillColor(...COLORS.cyan);
    pdf.roundedRect(17, y, 176, 10.4, 4, 4, 'F');
    text(pdf, 'Descriptif', 21, y + 6.7, 9.5, COLORS.white, 'bold');
    text(pdf, 'Nb.', 151, y + 6.7, 9.5, COLORS.white, 'bold', { align: 'center' });
    text(pdf, 'Tarif', 189, y + 6.7, 9.5, COLORS.white, 'bold', { align: 'right' });
    return y + 10.4;
  }

  async function build({ kind, data, number, cancelled = false }) {
    const [JsPDF, logo] = await Promise.all([loadJsPdf(), loadLogo()]);
    const pdf = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const name = kind === 'devis' ? 'Devis' : 'Facture';
    pdf.setProperties({ title: `${name} ${number || 'en préparation'} - Fantasy Kids Events`, author: 'Fantasy Kids Events', subject: 'Prestation Fantasy Kids Events' });
    let page = 1;
    header(pdf, kind, number, logo, false, cancelled);
    let y = customer(pdf, data, number, kind);
    y = tableTitle(pdf, y);

    const nextPage = (withTable = false) => {
      footer(pdf, data, page);
      pdf.addPage();
      page += 1;
      header(pdf, kind, number, logo, true, cancelled);
      y = withTable ? tableTitle(pdf, 49) : 53;
    };
    const room = height => { if (y + height > 247) nextPage(); };
    const lines = Array.isArray(data.lignes) ? data.lignes : [];
    let total = 0;
    lines.forEach((line, i) => {
      const qty = Number(line.quantite) || 0;
      const price = Number(line.prix) || 0;
      total += qty * price;
      const desc = wrap(pdf, line.description || 'Prestation', 111, 10);
      let start = 0;
      while (start < desc.length) {
        const canFit = Math.floor((243 - y - 7) / 5);
        if (canFit < 1) { nextPage(true); continue; }
        const fragment = desc.slice(start, start + canFit);
        const h = Math.max(13, fragment.length * 5 + 7);
        if (i % 2 === 0) {
          pdf.setFillColor(...COLORS.light);
          pdf.roundedRect(17, y + .5, 176, h - 1, 2, 2, 'F');
        }
        fragment.forEach((lineText, n) => text(pdf, lineText, 21, y + 8 + n * 5, 10, COLORS.ink));
        if (start === 0) {
          text(pdf, String(qty).replace('.', ','), 151, y + 8, 10, COLORS.ink, 'normal', { align: 'center' });
          text(pdf, amount(qty * price), 189, y + 8, 10, COLORS.ink, 'normal', { align: 'right' });
        }
        y += h;
        start += fragment.length;
        if (start < desc.length) nextPage(true);
      }
    });

    y += 4;
    if (value(data.note)) {
      const noteLines = wrap(pdf, data.note, 160, 9.5);
      // Chaque fragment reste dans un encadré pour conserver un PDF lisible, même sur deux pages.
      let index = 0;
      while (index < noteLines.length) {
        const count = Math.min(noteLines.length - index, Math.max(1, Math.floor((243 - y - 14) / 5)));
        const blockHeight = 11 + count * 5;
        room(blockHeight + 3);
        pdf.setFillColor(...COLORS.ice);
        pdf.roundedRect(17, y, 176, blockHeight, 3, 3, 'F');
        pdf.setFillColor(...COLORS.cyan);
        pdf.roundedRect(17, y, 1.7, blockHeight, .6, .6, 'F');
        const noteTitle = kind === 'devis' ? 'PRÉCISIONS SUR LA PRESTATION' : 'NOTE SUR LA FACTURE';
        text(pdf, index ? 'PRÉCISIONS (SUITE)' : noteTitle, 23, y + 7, 8.4, COLORS.cyan, 'bold');
        for (let n = 0; n < count; n++) text(pdf, noteLines[index + n], 23, y + 13 + n * 5, 9.5, COLORS.ink);
        index += count;
        y += blockHeight + 3;
      }
    }

    room(30);
    pdf.setDrawColor(...COLORS.border);
    pdf.setLineWidth(.35);
    pdf.line(110, y + .5, 193, y + .5);
    text(pdf, 'Sous-total', 133, y + 8, 9.5, COLORS.muted, 'normal', { align: 'right' });
    text(pdf, amount(total), 189, y + 8, 11, COLORS.ink, 'bold', { align: 'right' });
    y += 13;
    pdf.setFillColor(...COLORS.purple);
    pdf.roundedRect(109, y, 84, 14, 5, 5, 'F');
    text(pdf, 'TOTAL', 115, y + 9, 9.5, COLORS.white, 'bold');
    text(pdf, amount(total), 187, y + 9, 16, COLORS.white, 'bold', { align: 'right' });
    y += 19;

    const payment = [
      `Mode de paiement : virement bancaire`,
      `Compte : ${value(data.emetteur?.iban || '-')}`,
      kind === 'devis' ? `Devis valable jusqu'au : ${date(data.echeance)}` : `Échéance : ${date(data.echeance)}`
    ];
    const paymentHeight = payment.length * 5.2 + 10;
    room(paymentHeight + 2);
    pdf.setFillColor(...COLORS.light);
    pdf.roundedRect(17, y, 176, paymentHeight, 3, 3, 'F');
    pdf.setFillColor(...COLORS.cyan);
    pdf.roundedRect(17, y, 1.7, paymentHeight, .6, .6, 'F');
    payment.forEach((line, i) => text(pdf, line, 23, y + 8 + i * 5.2, 9, COLORS.ink));

    footer(pdf, data, page);
    return pdf;
  }

  window.fkExporterFacturePdf = async (params, action = 'download', targetWindow = null) => {
    try {
      const pdf = await build(params);
      const rawNumber = value(params.number || 'a-numeroter').replace(/[\\/]+/g, '-');
      const rawClient = value(params.data?.client?.nom || 'client').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '').slice(0, 45);
      const filename = `${params.kind === 'devis' ? 'Devis' : 'Facture'}_${rawNumber}_${rawClient || 'client'}.pdf`;
      if (action === 'print' && targetWindow && !targetWindow.closed) {
        const url = pdf.output('bloburl');
        targetWindow.location.replace(url);
      } else {
        if (targetWindow && !targetWindow.closed) targetWindow.close();
        pdf.save(filename);
      }
      return filename;
    } catch (error) {
      if (targetWindow && !targetWindow.closed) targetWindow.close();
      throw error;
    }
  };
})();
