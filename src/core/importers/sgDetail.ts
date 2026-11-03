// Reads the "Détail de l'écriture" column of Société Générale exports and extracts the
// operation type, a clean counterparty name and extra information (purchase date, foreign
// currency, creditor identifier, reason).

import { inferShortDate } from '../dates';
import type { ForeignInfo, OpType } from '../model';
import { parseAmount } from '../money';
import { cleanMerchant, displayMerchant, keyOf } from '../merchant';
import { squash, titleCase } from '../text';

export interface DetailInfo {
  opType: OpType;
  counterparty: string;
  merchantKey: string;
  opDate?: string;
  online?: boolean;
  foreign?: ForeignInfo;
  creditorId?: string;
  motif?: string;
  channel?: string;
  cardLast4?: string;
  place?: string;
}

const STOP_PAYEE = /\s+(?:REF\s*:|MOTIF\s*:|IBAN\s*:|DATE\s*:|ID\s*:|CPT\s|BQ\s)|\s+\d{2} \d{2} BQ\b/;

function cut(s: string, stop: RegExp): string {
  const m = s.match(stop);
  return squash(m ? s.slice(0, m.index) : s);
}

function after(s: string, marker: RegExp): string | null {
  const m = s.match(marker);
  if (!m || m.index === undefined) return null;
  return s.slice(m.index + m[0].length);
}

export { keyOf };

function parseCardRest(rest: string): { merchant: string; online: boolean; foreign?: ForeignInfo } {
  let r = squash(rest);
  // Trailing card reference such as "900000000000001IOPD"
  r = r.replace(/\s+\d{6,}[A-Z]{0,6}$/, '');
  let rate: number | undefined;
  const rateM = r.match(/\s+1 EUR\s*=\s*([\d,]+)\s+[A-Z]{3}$/);
  if (rateM) {
    rate = Number(rateM[1].replace(',', '.'));
    r = r.slice(0, rateM.index);
  }
  let online = false;
  if (/\s+COMMERCE ELECTRONIQUE$/.test(r)) {
    online = true;
    r = r.replace(/\s+COMMERCE ELECTRONIQUE$/, '');
  }
  let foreign: ForeignInfo | undefined;
  const fm = r.match(/\s+(\d+(?:[.,]\d{1,2})?)\s+([A-Z]{3})\s+([A-Z][A-Z .'-]*)$/);
  if (fm) {
    const amt = parseAmount(fm[1]);
    if (amt !== null) {
      foreign = { amount: amt, currency: fm[2], country: titleCase(fm[3]), rate };
      r = r.slice(0, fm.index);
    }
  }
  return { merchant: squash(r), online, foreign };
}

/** Interest paid by the bank on a savings account (not overdraft interest). */
export function isInterest(up: string, amount: number): boolean {
  return amount > 0 && /^(INTERETS?|INT\.?)\s+(CREDITEURS|ACQUIS|ANNUELS|CAPITALISES|\d{4})|^INTERETS?$|^INTERETS? (DE |DU |SUR )|^REMUNERATION/.test(up);
}

export function interestInfo(): DetailInfo {
  return { opType: 'interest', counterparty: 'Interest', merchantKey: 'INTERETS' };
}

/** "RETRAIT VERS COMPTE COURANT" on a savings statement moves money to another account, it is not cash. */
export function isAccountWithdrawal(up: string): boolean {
  return /^RETRAIT\b/.test(up) && !/\bDAB\b|\bGAB\b|GUICHET|ESPECES|CARTE|\bDU \d{2}\/\d{2}/.test(up);
}

export function accountWithdrawal(up: string, amount: number): DetailInfo {
  const to = up.match(/\b(?:VERS|SUR|AU PROFIT DE)\s+(.+)$/)?.[1]?.trim();
  return {
    opType: amount > 0 ? 'transfer_in' : 'transfer_out',
    counterparty: to ? 'Withdrawal to ' + titleCase(to) : 'Withdrawal',
    merchantKey: 'RETRAIT ' + keyOf(to ?? 'COMPTE'),
  };
}

export function parseSgDetail(label: string, detail: string, bookingIso: string, amount: number): DetailInfo {
  const text = squash(detail || label);
  const up = text.toUpperCase();

  // Fee on a card payment outside the euro zone
  if (/^FRAIS PAIEMENT HORS ZONE EURO/.test(up)) {
    const m = up.match(/CARTE X(\d{4}) (\d{2}\/\d{2})\s*(.*)$/);
    const info: DetailInfo = {
      opType: 'card_fee',
      counterparty: 'Card fee outside euro zone',
      merchantKey: 'FRAIS PAIEMENT HORS ZONE EURO',
    };
    if (m) {
      info.cardLast4 = m[1];
      info.opDate = inferShortDate(m[2], bookingIso) ?? undefined;
      const f = parseCardRest('X ' + m[3]).foreign;
      if (f) info.foreign = f;
    }
    return info;
  }

  if (isAccountWithdrawal(up)) return accountWithdrawal(up, amount);

  if (/RETRAIT DAB|^RETRAIT\b/.test(up)) {
    const m = up.match(/CARTE X(\d{4}) .*?(\d{2}\/\d{2})/);
    const place = cut(up.replace(/^.*RETRAIT DAB\s*(\d{2}\/\d{2})?\s*/, ''), /\s+\d{6,}[A-Z]{0,6}$/);
    return {
      opType: 'cash_withdrawal',
      counterparty: place ? 'Cash withdrawal ' + titleCase(place) : 'Cash withdrawal',
      merchantKey: 'RETRAIT DAB',
      cardLast4: m?.[1],
      opDate: m ? inferShortDate(m[2], bookingIso) ?? undefined : undefined,
    };
  }

  const card = up.match(/^CARTE X(\d{4}) (\d{2}\/\d{2})\s+(.*)$/);
  if (card) {
    const { merchant, online, foreign } = parseCardRest(text.slice(text.length - card[3].length));
    const name = cleanMerchant(merchant || 'Card payment');
    return {
      opType: amount > 0 ? 'card_refund' : 'card',
      counterparty: displayMerchant(name),
      merchantKey: keyOf(name),
      opDate: inferShortDate(card[2], bookingIso) ?? undefined,
      online: online || undefined,
      foreign,
      cardLast4: card[1],
    };
  }

  if (/^VIR(EMENT)?\s+RECU|^VIR(EMENT)?\s+INST(ANTANE)?\s+RECU|^VIR(EMENT)?\s+SEPA\s+RECU/.test(up)) {
    const fromRaw = after(text, /DE\s*:\s*/i);
    const payer = fromRaw ? cut(fromRaw, /\s+(?:MOTIF\s*:|REF\s*:|ID\s*:)/i) : '';
    const motifRaw = after(text, /MOTIF\s*:\s*/i);
    const motif = motifRaw ? cut(motifRaw, /\s+REF\s*:/i) : undefined;
    return {
      opType: 'transfer_in',
      counterparty: payer ? titleCase(payer) : 'Transfer received',
      merchantKey: 'FROM ' + keyOf(payer || 'UNKNOWN'),
      motif,
    };
  }

  if (/VIR(EMENT)?\s+PERM/.test(up) || /VIR(EMENT)?\s+INSTANTANE\s+EMIS|VIR(EMENT)?\s+INST\s+EMIS/.test(up) || /VIR(EMENT)?\s+(EUROPEEN|SEPA)?\s*EMIS/.test(up)) {
    const opType: OpType = /PERM/.test(up) ? 'standing_order' : /INST/.test(up) ? 'instant_transfer_out' : 'transfer_out';
    const channel = up.match(/EMIS\s+([A-Z]+)\s+POUR\s*:/)?.[1];
    const toRaw = after(text, /POUR\s*:\s*/i);
    const payee = toRaw ? cut(toRaw, STOP_PAYEE) : '';
    const motifRaw = after(text, /MOTIF\s*:\s*/i);
    const motif = motifRaw ? cut(motifRaw, /\s+(?:REF\s*:|DATE\s*:)/i) : undefined;
    return {
      opType,
      counterparty: payee ? titleCase(payee) : 'Transfer sent',
      merchantKey: 'TO ' + keyOf(payee || 'UNKNOWN'),
      motif,
      channel,
    };
  }

  if (/^PRELEVEMENT|^PRLV/.test(up)) {
    const deRaw = after(text, /DE\s*:\s*/i);
    let creditor = deRaw ? cut(deRaw, /\s+(?:ID\s*:|MOTIF\s*:|REF\s*:)/i) : '';
    creditor = creditor.replace(/\s+\d+$/, '');
    const creditorId = text.match(/ID\s*:\s*([A-Z0-9]+)/i)?.[1];
    const motifRaw = after(text, /MOTIF\s*:\s*/i);
    const motif = motifRaw ? cut(motifRaw, /\s+(?:REF\s*:|ID\s*:)/i) : undefined;
    return {
      opType: 'direct_debit',
      counterparty: creditor ? titleCase(creditor) : 'Direct debit',
      merchantKey: creditorId ? 'ICS ' + creditorId : keyOf(creditor || 'PRELEVEMENT'),
      creditorId,
      motif,
    };
  }

  if (/^(REMISE\s+)?CHEQUE|^CHQ/.test(up)) {
    return { opType: 'cheque', counterparty: amount > 0 ? 'Cheque deposit' : 'Cheque', merchantKey: 'CHEQUE' };
  }

  if (isInterest(up, amount)) return interestInfo();

  if (/^(FRAIS|COTISATION|COMMISSION|AGIOS|INTERETS DEBITEURS)/.test(up)) {
    const name = cut(text, /\s+\d{6,}/);
    return { opType: 'bank_fee', counterparty: titleCase(name), merchantKey: keyOf(name) };
  }

  const name = label || text;
  return { opType: 'other', counterparty: titleCase(name), merchantKey: keyOf(name) };
}
