const NEGATIVE_LABEL = /\b(discounts?|refunds?|void(?:ed|s)?|expenses?|costs?|cogs|purchases?|wastage|consumption|outflows?|salary|salaries|deductions?|payables?|cash out|online out|bank out|returns?|reversals?)\b/i;
const POSITIVE_LABEL = /\b(sales?|revenue|received|collections?|collected|cash in|online in|bank in|deposits?|saved|savings|income|profits?)\b/i;
const CONDITIONAL_LABEL = /\b(profits?|difference|impact)\b/i;

export function financialTone({ label = '', value = 0, tone, sign = '' } = {}) {
  if (tone === 'positive' || tone === 'negative' || tone === 'warning') return tone;
  if (sign === '-') return 'negative';
  if (sign === '+') return 'positive';

  const text = String(label);
  const number = Number(value || 0);
  if (NEGATIVE_LABEL.test(text)) return 'negative';
  if (CONDITIONAL_LABEL.test(text)) return number < 0 ? 'negative' : number > 0 ? 'positive' : 'neutral';
  if (POSITIVE_LABEL.test(text)) return 'positive';
  return 'neutral';
}

export function financialToneClass(options) {
  const tone = financialTone(options);
  if (tone === 'positive') return 'text-emerald-700';
  if (tone === 'negative') return 'text-rose-700';
  if (tone === 'warning') return 'text-amber-700';
  return 'text-gray-950';
}
