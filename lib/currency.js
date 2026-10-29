// Currency formatting utility for Nepali Rupees
export const formatCurrency = (amount) => {
  return `Rs ${parseFloat(amount).toFixed(2)}`
}

export const formatCurrencyShort = (amount) => {
  return `Rs ${parseFloat(amount).toFixed(0)}`
}
