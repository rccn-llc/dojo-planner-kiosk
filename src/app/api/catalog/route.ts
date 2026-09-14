import { and, asc, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { catalogItem, catalogItemImage, catalogItemVariant } from '@/lib/catalogSchema';
import { resolveOrgIdFromRequest } from '@/lib/clerk';
import { getDatabaseForOrg } from '@/lib/tenantDirectory';

export interface StoreProductVariant {
  id: string;
  name: string;
  price: number;
  /** Units left, or null when the item does not track inventory. */
  stockQuantity: number | null;
}

export interface StoreProductResponse {
  id: string;
  name: string;
  description: string;
  images: string[];
  variants?: StoreProductVariant[];
  basePrice: number;
  priceRange?: { min: number; max: number };
  /** False for made-to-order / unlimited items; their stock is always null. */
  trackInventory: boolean;
  /** Units of this product a single order may contain. */
  maxPerOrder: number;
  /**
   * Total units purchasable right now across every variant, or null when
   * inventory is not tracked. Zero means the whole product is sold out.
   */
  availableStock: number | null;
}

export async function GET(request: Request) {
  try {
    // Resolve org from URL slug first, then the single-org env var. This must
    // precede the connection: which database to open now depends on it.
    let orgId = await resolveOrgIdFromRequest(request);
    orgId ??= process.env.ORGANIZATION_ID ?? null;
    if (!orgId) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 400 });
    }

    const db = await getDatabaseForOrg(orgId);

    // Fetch kiosk-visible active items for this org, ordered by sortOrder
    const items = await db
      .select()
      .from(catalogItem)
      .where(
        and(
          eq(catalogItem.organizationId, orgId),
          eq(catalogItem.isActive, true),
          eq(catalogItem.showOnKiosk, true),
        ),
      )
      .orderBy(asc(catalogItem.sortOrder));

    if (items.length === 0) {
      return NextResponse.json({ products: [] });
    }

    const itemIds = items.map(i => i.id);

    // Fetch variants and images sequentially (pglite-server doesn't support parallel connections)
    const variants = await db
      .select()
      .from(catalogItemVariant)
      .where(inArray(catalogItemVariant.catalogItemId, itemIds))
      .orderBy(asc(catalogItemVariant.sortOrder));

    const images = await db
      .select()
      .from(catalogItemImage)
      .where(inArray(catalogItemImage.catalogItemId, itemIds))
      .orderBy(asc(catalogItemImage.sortOrder));

    // Group variants and images by catalogItemId
    const variantsByItem = new Map<string, typeof variants>();
    for (const v of variants) {
      const existing = variantsByItem.get(v.catalogItemId) ?? [];
      existing.push(v);
      variantsByItem.set(v.catalogItemId, existing);
    }

    const imagesByItem = new Map<string, typeof images>();
    for (const img of images) {
      const existing = imagesByItem.get(img.catalogItemId) ?? [];
      existing.push(img);
      imagesByItem.set(img.catalogItemId, existing);
    }

    // Shape into StoreProductResponse[]
    const products: StoreProductResponse[] = items.map((item) => {
      const itemVariants = variantsByItem.get(item.id) ?? [];
      const itemImages = imagesByItem.get(item.id) ?? [];

      // Sort images: primary first, then by sortOrder
      const sortedImages = [...itemImages].sort((a, b) => {
        if (a.isPrimary && !b.isPrimary) {
          return -1;
        }
        if (!a.isPrimary && b.isPrimary) {
          return 1;
        }
        return a.sortOrder - b.sortOrder;
      });

      const imageUrls = sortedImages.map(img => img.url);

      // `track_inventory` defaults to true upstream, so a NULL here means the
      // planner never set it — treat that as "tracked", the safe reading. The
      // unsafe reading sells stock the dojo does not have.
      const tracksInventory = item.trackInventory !== false;

      const mappedVariants: StoreProductVariant[] = itemVariants.map(v => ({
        id: v.id,
        name: v.name,
        price: v.price,
        stockQuantity: tracksInventory ? v.stockQuantity ?? 0 : null,
      }));

      const priceRange = mappedVariants.length > 0
        ? {
            min: Math.min(...mappedVariants.map(v => v.price)),
            max: Math.max(...mappedVariants.map(v => v.price)),
          }
        : undefined;

      let availableStock: number | null = null;
      if (tracksInventory) {
        availableStock = mappedVariants.length > 0
          ? mappedVariants.reduce((sum, v) => sum + Math.max(0, v.stockQuantity ?? 0), 0)
          // A variant-less tracked item has nowhere to store a count in this
          // schema (stock lives on the variant row). Treat it as available
          // rather than hiding a product the dojo does stock.
          : null;
      }

      return {
        id: item.id,
        name: item.name,
        description: item.description ?? '',
        images: imageUrls,
        variants: mappedVariants.length > 0 ? mappedVariants : undefined,
        basePrice: item.basePrice,
        priceRange,
        trackInventory: tracksInventory,
        maxPerOrder: item.maxPerOrder ?? 10,
        availableStock,
      };
    });

    return NextResponse.json({ products });
  }
  catch (error) {
    console.error('[catalog/route] Failed to load catalog:', error);
    return NextResponse.json({ error: 'Failed to load catalog' }, { status: 500 });
  }
}
