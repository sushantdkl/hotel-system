'use client'

import { Edit2, Trash2 } from 'lucide-react'

export default function ProductTable({ products, onEdit, onDelete }) {
  return (
    <>
      <div className="block md:hidden space-y-3">
        {products.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">No products found</p>
        ) : (
          products.map((product) => {
            const cost = product.cost || 0
            const profit = product.price - cost
            const profitMargin = product.price > 0 ? ((profit / product.price) * 100).toFixed(1) : '0.0'
            return (
              <div key={product.id} className="p-4 border border-border rounded-lg space-y-3">
                <div className="flex justify-between items-start gap-2">
                  <div className="flex-1">
                    <h4 className="font-semibold text-foreground">{product.name}</h4>
                    <p className="text-xs text-muted-foreground font-mono">{product.barcode}</p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => onEdit(product)}
                      className="text-primary hover:bg-primary/10 p-2 rounded transition-colors"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => onDelete(product.id)}
                      className="text-destructive hover:bg-destructive/10 p-2 rounded transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Price:</span>
                    <p className="font-bold">Rs {product.price.toFixed(2)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Cost:</span>
                    <p className="font-bold">Rs {cost.toFixed(2)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Profit:</span>
                    <p className="font-bold text-green-600">Rs {profit.toFixed(2)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Stock:</span>
                    <p className={`font-bold ${product.stock < 5 ? 'text-destructive' : ''}`}>{product.stock}</p>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50">
            <tr className="text-muted-foreground font-semibold">
              <th className="text-left py-3 px-4">Product Name</th>
              <th className="text-left py-3 px-4">Barcode</th>
              <th className="text-left py-3 px-4">Category</th>
              <th className="text-right py-3 px-4">Price</th>
              <th className="text-right py-3 px-4">Cost</th>
              <th className="text-right py-3 px-4">Profit</th>
              <th className="text-right py-3 px-4">Stock</th>
              <th className="text-left py-3 px-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr>
                <td colSpan="8" className="text-center py-8 text-muted-foreground">
                  No products found
                </td>
              </tr>
            ) : (
              products.map((product) => {
                const cost = product.cost || 0
                const profit = product.price - cost
                const profitMargin = product.price > 0 ? ((profit / product.price) * 100).toFixed(1) : '0.0'
                return (
                  <tr key={product.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                    <td className="py-3 px-4 font-semibold text-foreground">{product.name}</td>
                    <td className="py-3 px-4 text-muted-foreground font-mono text-xs">{product.barcode}</td>
                    <td className="py-3 px-4">{product.category}</td>
                    <td className="py-3 px-4 text-right font-bold">Rs {product.price.toFixed(2)}</td>
                    <td className="py-3 px-4 text-right">Rs {cost.toFixed(2)}</td>
                    <td className="py-3 px-4 text-right">
                      <span className="text-green-600 dark:text-green-400 font-bold">
                        Rs {profit.toFixed(2)} ({profitMargin}%)
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className={product.stock < 5 ? 'text-destructive font-bold' : ''}>
                        {product.stock}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => onEdit(product)}
                          className="text-primary hover:bg-primary/10 p-2 rounded transition-colors"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => onDelete(product.id)}
                          className="text-destructive hover:bg-destructive/10 p-2 rounded transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
