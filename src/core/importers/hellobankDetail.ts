// Reads Hello bank operation labels, for example
// "PAIEMENT CB NETFLIX DU 01/01/26 A AMSTERDAM - CARTE*1234" or
// "PRELEVEMENT SFR DU 01/01/26 - EMETTEUR : FR00ZZZ000003 MDT - MOTIF : ... - REF : ...".

import { parseFrDate } from '../dates';
import { cleanMerchant, displayMerchant, keyOf } from '../merchant';
import { squash, titleCase } from '../text';
import { accountWithdrawal, interestInfo, isAccountWithdrawal, isInterest, type DetailInfo } from './sgDetail';

function section(text: string, marker: RegExp, stop: RegExp = /\s+-\s+[A-Z]+\s*:|\s+LIB$/): string | undefined {
  const m = text.match(marker);
  if (!m || m.index === undefined) return undefined;
  const rest = text.slice(m.index + m[0].length);
  const s = rest.match(stop);
  return squash(s && s.index !== undefined ? rest.slice(0, s.index) : rest) || undefined;
}

export function parseHellobankDetail(label: string, amount: number): DetailInfo {
  const text = squash(label);
  const up = text.toUpperCase();

  const card = up.match(/^(PAIEMENT|REMBOURSEMENT|AVOIR)\s+CB\s+(.+?)(?:\s+DU\s+(\d{2}\/\d{2}\/\d{2,4}))?(?:\s+A\s+(.+?))?(?:\s+-\s+CARTE\s*\*\s*(\d{4}))?$/);
  if (card) {
    const merchant = cleanMerchant(card[2]);
    return {
      opType: card[1] === 'PAIEMENT' && amount < 0 ? 'card' : 'card_refund',
      counterparty: displayMerchant(merchant),
      merchantKey: keyOf(merchant),
      opDate: card[3] ? parseFrDate(card[3]) ?? undefined : undefined,
      place: card[4] ? titleCase(card[4]) : undefined,
      cardLast4: card[5],
    };
  }

  if (isAccountWithdrawal(up)) return accountWithdrawal(up, amount);

  if (/^RETRAIT/.test(up)) {
    const m = up.match(/DU\s+(\d{2}\/\d{2}\/\d{2,4})(?:\s+A\s+(.+?))?(?:\s+-\s+CARTE|$)/);
    return {
      opType: 'cash_withdrawal',
      counterparty: m?.[2] ? 'Cash withdrawal ' + titleCase(m[2]) : 'Cash withdrawal',
      merchantKey: 'RETRAIT DAB',
      opDate: m?.[1] ? parseFrDate(m[1]) ?? undefined : undefined,
    };
  }

  if (/^PRELEVEMENT|^PRLV/.test(up)) {
    let creditor = up.match(/^(?:PRELEVEMENT|PRLV)(?:\s+SEPA)?\s+(.+?)(?:\s+DU\s+\d{2}\/\d{2}\/\d{2,4}|\s+-\s+EMETTEUR|$)/)?.[1] ?? '';
    creditor = creditor.replace(/\s+\d+$/, '');
    const creditorId = up.match(/EMETTEUR\s*:\s*([A-Z0-9]+)/)?.[1];
    const opDate = up.match(/DU\s+(\d{2}\/\d{2}\/\d{2,4})/)?.[1];
    return {
      opType: 'direct_debit',
      counterparty: creditor ? titleCase(creditor) : 'Direct debit',
      merchantKey: creditorId ? 'ICS ' + creditorId : keyOf(creditor || 'PRELEVEMENT'),
      creditorId,
      motif: section(text, /MOTIF\s*:\s*/i),
      opDate: opDate ? parseFrDate(opDate) ?? undefined : undefined,
    };
  }

  if (/^VIR(EMENT)?\b/.test(up)) {
    const motif = section(text, /\/?MOTIF\s*:?\s+/i, /\s+-\s+REF\s*:|\s+\/?REF\b|\s+\/|$/);
    if (amount > 0) {
      const payer = up.match(/(?:\/|\b)DE\s+(.+?)(?:\s+-?\s*\/?MOTIF\b|\s+-?\s*\/?REF\b|\s+\/|$)/)?.[1] ?? '';
      return {
        opType: 'transfer_in',
        counterparty: payer ? titleCase(payer) : 'Transfer received',
        merchantKey: 'FROM ' + keyOf(payer || 'UNKNOWN'),
        motif,
        channel: /INSTANTANE/.test(up) ? 'instant' : undefined,
      };
    }
    const payee = up.match(/(?:\/|\b)(?:POUR|VERS|A|AU PROFIT DE)\s+(.+?)(?:\s+-?\s*\/?MOTIF\b|\s+-?\s*\/?REF\b|\s+\/|$)/)?.[1] ?? '';
    return {
      opType: /PERMANENT/.test(up) ? 'standing_order' : /INSTANTANE/.test(up) ? 'instant_transfer_out' : 'transfer_out',
      counterparty: payee ? titleCase(payee) : 'Transfer sent',
      merchantKey: 'TO ' + keyOf(payee || 'UNKNOWN'),
      motif,
    };
  }

  if (isInterest(up, amount)) return interestInfo();

  if (/^(FRAIS|COMMISSION|COTISATION|AGIOS|INTERETS DEBITEURS)/.test(up)) {
    const name = section(text, /^/, /\s+-\s+|\s+DU\s+\d/) ?? text;
    return { opType: 'bank_fee', counterparty: titleCase(name), merchantKey: keyOf(name) };
  }

  if (/CHEQUE/.test(up)) {
    return { opType: 'cheque', counterparty: amount > 0 ? 'Cheque deposit' : 'Cheque', merchantKey: 'CHEQUE' };
  }

  const name = section(text, /^/, /\s+-\s+|\s+DU\s+\d/) ?? text;
  return { opType: 'other', counterparty: titleCase(name), merchantKey: keyOf(name) };
}
