import * as React from "react"

import { AIProductTile } from "./AIProductTile"
import { cn } from "~/lib/utils"

interface AIProductTileGridProps extends React.ComponentProps<"div"> {
  tiles: Array<{
    icon?: React.ReactNode
    title?: string
    description?: string
  }>
}

function AIProductTileGrid({
  className,
  tiles,
  ...props
}: AIProductTileGridProps) {
  return (
    <div
      data-slot="ai-product-tile-grid"
      className={cn(
        "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6",
        className
      )}
      {...props}
    >
      {tiles.map((tile, index) => (
        <AIProductTile
          key={index}
          icon={tile.icon}
          title={tile.title}
          description={tile.description}
        />
      ))}
    </div>
  )
}

export { AIProductTileGrid }