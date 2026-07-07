import type { VariantProps } from "class-variance-authority"
import { ProductCard, productCardVariants } from "~/components/ui/ProductCard"

type ProductCardVariant = VariantProps<typeof productCardVariants>["variant"]

interface ProductMatrixItem {
  title: string
  tagline: string
  variant: ProductCardVariant
}

interface ProductMatrixGridProps {
  items: ProductMatrixItem[]
  className?: string
}

export function ProductMatrixGrid({ items, className }: ProductMatrixGridProps) {
  return (
    <div className="bg-canvas rounded-[32px] px-8 py-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {items.map((item) => (
          <ProductCard
            key={item.variant + item.title}
            variant={item.variant}
            title={item.title}
            tagline={item.tagline}
          />
        ))}
      </div>
    </div>
  )
}
