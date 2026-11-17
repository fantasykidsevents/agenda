/* Export A4 Fantasy Kids Events : la mise en page ne dépend pas de l'impression HTML. */
(() => {
  'use strict';

  let jsPdfLoader;
  const TEMPLATE_VERSION='magique-20261117-v2';
  window.fkFacturesPdfVersion=TEMPLATE_VERSION;
  const COLORS = {
    cyan: [0, 181, 235], purple: [82, 25, 119], pink: [203, 27, 179],
    ink: [62, 25, 86], muted: [108, 81, 124], light: [252, 246, 255],
    ice: [251, 244, 255], border: [174, 77, 215], gold: [213, 165, 73], white: [255, 255, 255]
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

  async function loadImage(path) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = new URL(path, document.baseURI).href;
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

  function text(pdf, label, x, y, size = 10, color = COLORS.ink, weight = 'normal', options = {}, family = 'helvetica') {
    pdf.setFont(family, weight);
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    pdf.text(String(label), x, y, options);
  }

  function wrap(pdf, content, width, size = 10, weight = 'normal') {
    pdf.setFont('helvetica', weight);
    pdf.setFontSize(size);
    return value(content).split('\n').flatMap(line => pdf.splitTextToSize(line || ' ', width));
  }

  function header(pdf, kind, number, logo, background, continuation = false, cancelled = false) {
    // Fond de page décoratif uniquement : tout le texte reste vectoriel et net.
    if (background) pdf.addImage(background, 'JPEG', 0, 0, 210, 297);
    const label = cancelled ? 'DEVIS ANNULÉ' : kind === 'devis' ? 'DEVIS' : 'FACTURE';
    text(pdf, continuation ? `${label} (SUITE)` : label, 18, continuation ? 35 : 42, continuation ? 24 : cancelled ? 28 : 38, COLORS.purple, 'bold', {}, 'times');
    if (!continuation) {
      text(pdf, 'De la magie plein les yeux', 21, 52, 12, COLORS.purple, 'italic', {}, 'times');
    } else {
      text(pdf, number || 'Document non numéroté', 19, 44, 9, COLORS.muted);
    }
    if (logo) pdf.addImage(logo, 'PNG', 134, continuation ? 23 : 24, 59, 37);
    else text(pdf, 'Fantasy Kids Events', 190, 43, 12, COLORS.purple, 'bold', { align: 'right' });
  }

  function footer(pdf, data, page) {
    const issuer = data.emetteur || {};
    pdf.setDrawColor(...COLORS.gold);
    pdf.setLineWidth(.35);
    pdf.line(18, 251, 119, 251);
    text(pdf, issuer.nom || 'Fantasy Kids Events', 19, 257.5, 12.5, COLORS.purple, 'bold', {}, 'times');
    const details = wrap(pdf, [issuer.adresse, issuer.contact].filter(Boolean).join('\n'), 100, 8.2);
    details.slice(0, 4).forEach((line, i) => text(pdf, line, 19, 262 + i * 3.3, 8.2, COLORS.ink));
    const end = 262 + Math.min(4, details.length) * 3.3;
    text(pdf, 'N° entreprise / TVA : ' + value(issuer.tva || '-'), 19, end + 1, 8.2, COLORS.ink);
    text(pdf, 'IBAN : ' + value(issuer.iban || '-'), 19, end + 4.6, 8.2, COLORS.ink);
    const regime = wrap(pdf, data.regime_tva || '', 110, 7.4);
    regime.slice(0, 2).forEach((line, i) => text(pdf, line, 19, end + 8.2 + i * 3.3, 7.4, COLORS.muted));
    text(pdf, `Page ${page}`, 189, 289, 8, COLORS.muted, 'normal', { align: 'right' });
  }

  function customer(pdf, data, number, kind) {
    const client = data.client || {};
    const addr = wrap(pdf, client.adresse || 'Adresse du client', 100, 10);
    const name = wrap(pdf, client.nom || 'Nom du client', 100, 12, 'bold');
    const vat = client.tva ? wrap(pdf, client.tva, 100, 10) : [];
    const bodyHeight = 12 + name.length * 5 + 5 + addr.length * 4.7 + (vat.length ? 6 + vat.length * 4.7 : 0);
    const y = 66, cardHeight = Math.max(42, bodyHeight + 8);
    pdf.setFillColor(...COLORS.light);
    pdf.setDrawColor(...COLORS.border);
    pdf.setLineWidth(.36);
    pdf.roundedRect(17, y, 176, cardHeight, 4, 4, 'FD');
    pdf.setDrawColor(223, 197, 234);
    pdf.line(132, y + 9, 132, y + cardHeight - 7);
    text(pdf, 'CLIENT', 23, y + 9, 12, COLORS.purple, 'bold', {}, 'times');
    let cursor = y + 17;
    name.forEach(line => { text(pdf, line, 23, cursor, 11.5, COLORS.ink, 'bold'); cursor += 5; });
    cursor += 1.6;
    addr.forEach(line => { text(pdf, line, 23, cursor, 10, COLORS.ink); cursor += 4.7; });
    if (vat.length) {
      cursor += 2;
      text(pdf, 'N° de TVA :', 23, cursor, 9.5, COLORS.purple, 'bold');
      vat.forEach((line,i) => text(pdf, line, 47, cursor + i * 4.7, 10, COLORS.ink));
    }
    text(pdf, kind === 'devis' ? 'N° DE DEVIS' : 'N° DE FACTURE', 137, y + 11, 8, COLORS.purple, 'bold');
    const numberLines = wrap(pdf, number || 'À numéroter', 48, 10.2, 'bold');
    numberLines.forEach((line, i) => text(pdf, line, 137, y + 18 + i * 5, 10.2, COLORS.ink, 'bold'));
    text(pdf, 'DATE D’ÉMISSION', 137, y + cardHeight - 13, 8, COLORS.purple, 'bold');
    text(pdf, date(data.date_emission || new Date().toISOString().slice(0, 10)), 137, y + cardHeight - 6, 10, COLORS.ink);
    const afterCard = y + cardHeight;
    if (data.date_prestation) {
      text(pdf, `Date de la prestation : ${date(data.date_prestation)}`, 19, afterCard + 6, 8.5, COLORS.muted);
    }
    return afterCard + 16;
  }

  function tableTitle(pdf, y) {
    const top = y;
    for(let x=17;x<193;x+=2){const t=(x-17)/176;pdf.setFillColor(Math.round(82+121*t),Math.round(25+2*t),Math.round(119+60*t));pdf.rect(x,top,Math.min(2,193-x),10,'F');}
    pdf.setDrawColor(...COLORS.border);pdf.setLineWidth(.3);pdf.roundedRect(17,top,176,10,3,3,'S');
    text(pdf, 'DESCRIPTIF', 22, top + 6.6, 10.4, COLORS.white, 'bold', {}, 'times');
    text(pdf, 'QTÉ', 151, top + 6.6, 10.4, COLORS.white, 'bold', {align:'center'}, 'times');
    text(pdf, 'MONTANT', 189, top + 6.6, 10.4, COLORS.white, 'bold', {align:'right'}, 'times');
    return top + 10;
  }

  async function build({ kind, data, number, cancelled = false }) {
    const [JsPDF, logo, background] = await Promise.all([loadJsPdf(), loadImage('logo.png'), loadImage('factures-fond-magique.jpg')]);
    const pdf = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const name = kind === 'devis' ? 'Devis' : 'Facture';
    pdf.setProperties({ title: `${name} ${number || 'en préparation'} - Fantasy Kids Events`, author: 'Fantasy Kids Events', subject: `Prestation Fantasy Kids Events - modèle ${TEMPLATE_VERSION}` });
    let page = 1;
    header(pdf, kind, number, logo, background, false, cancelled);
    let y = customer(pdf, data, number, kind);
    y = tableTitle(pdf, y);

    const nextPage = (withTable = false) => {
      footer(pdf, data, page);
      pdf.addPage();
      page += 1;
      header(pdf, kind, number, logo, background, true, cancelled);
      y = withTable ? tableTitle(pdf, 69) : 72;
    };
    const room = height => { if (y + height > 242) nextPage(); };
    const lines = Array.isArray(data.lignes) ? data.lignes : [];
    let total = 0;
    lines.forEach((line, i) => {
      const qty = Number(line.quantite) || 0;
      const price = Number(line.prix) || 0;
      total += qty * price;
      const desc = wrap(pdf, line.description || 'Prestation', 111, 10);
      let start = 0;
      while (start < desc.length) {
        const canFit = Math.floor((237 - y - 7) / 5);
        if (canFit < 1) { nextPage(true); continue; }
        const fragment = desc.slice(start, start + canFit);
        const h = Math.max(13, fragment.length * 5 + 7);
        if (i % 2 === 0) {pdf.setFillColor(...COLORS.light);pdf.rect(17,y,176,h,'F');}
        fragment.forEach((lineText, n) => text(pdf, lineText, 21, y + 8 + n * 5, 10, COLORS.ink));
        if (start === 0) {
          text(pdf, String(qty).replace('.', ','), 151, y + 8, 10, COLORS.ink, 'normal', { align: 'center' });
          text(pdf, amount(qty * price), 189, y + 8, 10, COLORS.ink, 'normal', { align: 'right' });
        }
        pdf.setDrawColor(222,200,235);pdf.setLineWidth(.22);pdf.line(17,y+h,193,y+h);
        y += h;
        start += fragment.length;
        if (start < desc.length) nextPage(true);
      }
    });

    y += 9;
    const noteLines = value(data.note) ? wrap(pdf, data.note, 101, 9.8) : [];
    const noteTitle = kind === 'devis' ? 'PRÉCISIONS SUR LA PRESTATION' : 'NOTE SUR LA FACTURE';
    const totalBadge = top => {
      text(pdf, 'Sous-total : ' + amount(total), 189, top + 5, 8.8, COLORS.muted, 'normal', { align: 'right' });
      pdf.setFillColor(110,20,146);pdf.setDrawColor(...COLORS.gold);pdf.setLineWidth(.5);
      pdf.roundedRect(142,top+9,51,15,5,5,'FD');
      text(pdf, 'Total',167.5,top+14.5,9.2,COLORS.white,'italic',{align:'center'},'times');
      text(pdf,amount(total),167.5,top+21,13.4,COLORS.white,'bold',{align:'center'},'times');
    };
    if(noteLines.length <= 5){
      const noteHeight = noteLines.length ? Math.max(27,15+noteLines.length*4.9) : 0;
      room(Math.max(33,noteHeight)+34);
      if(noteLines.length){
        pdf.setFillColor(...COLORS.light);pdf.setDrawColor(...COLORS.border);pdf.setLineWidth(.35);
        pdf.roundedRect(17,y,113,noteHeight,3,3,'FD');
        text(pdf,noteTitle,21,y+7,9.2,COLORS.purple,'bold',{},'times');
        noteLines.forEach((line,i)=>text(pdf,line,21,y+14+i*4.9,9.8,COLORS.ink));
      }
      totalBadge(y);
      y+=Math.max(33,noteHeight)+5;
    }else{
      let index=0;
      while(index<noteLines.length){
        if(y>220)nextPage();
        const count=Math.min(noteLines.length-index,Math.max(1,Math.floor((238-y-16)/5)));
        const blockHeight=13+count*5;
        room(blockHeight+3);
        pdf.setFillColor(...COLORS.light);pdf.setDrawColor(...COLORS.border);pdf.setLineWidth(.35);
        pdf.roundedRect(17,y,176,blockHeight,3,3,'FD');
        text(pdf,index?`${noteTitle} (SUITE)`:noteTitle,21,y+7,9.3,COLORS.purple,'bold',{},'times');
        for(let i=0;i<count;i++)text(pdf,noteLines[index+i],21,y+14+i*5,9.7,COLORS.ink);
        index+=count;y+=blockHeight+5;
      }
      room(36);totalBadge(y);y+=33;
    }

    const payment = [
      `Mode de paiement : virement bancaire`,
      `Compte : ${value(data.emetteur?.iban || '-')}`,
      kind === 'devis' ? `Devis valable jusqu'au : ${date(data.echeance)}` : `Échéance : ${date(data.echeance)}`
    ];
    const paymentHeight = payment.length * 4.7 + 9;
    room(paymentHeight + 2);
    pdf.setFillColor(...COLORS.light);
    pdf.setDrawColor(231,214,237);pdf.setLineWidth(.25);
    pdf.roundedRect(17, y, 114, paymentHeight, 3, 3, 'FD');
    payment.forEach((line, i) => text(pdf, line, 21, y + 7 + i * 4.7, 8.8, COLORS.ink));

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
