export function formatMenuPrice(price) {
  if (price == null || price === '') return 'Rs. 0'
  if (typeof price === 'string' && /[\/,]/.test(price) && Number.isNaN(Number(price))) {
    return `Rs. ${price}`
  }
  const n = Number(price)
  if (!Number.isFinite(n)) return `Rs. ${price}`
  return `Rs. ${n.toLocaleString('en-NP')}`
}
