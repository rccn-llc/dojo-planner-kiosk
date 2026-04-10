import { and, asc, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { catalogItem, catalogItemImage, catalogItemVariant } from '@/lib/catalogSchema';
import { getDatabase } from '@/lib/database';
import { validateDevice } from '@/lib/deviceAuth';

export interface StoreProductVariant {
  id: string;
  name: string;
  price: number;
}

export interface StoreProductResponse {
  id: string;
  name: string;
  description: string;
  images: string[];
  variants?: StoreProductVariant[];
  basePrice: number;
  priceRange?: { min: number; max: number };
}

export async function GET(request: Request) {
  try {
    const db = getDatabase();

    // Resolve org ID from device cert (production) or env var (development)
    const device = await validateDevice(request);
    const orgId = device?.orgId ?? process.env.ORGANIZATION_ID;

    if (!orgId) {
      return NextResponse.json({ error: 'Organization context not available' }, { status: 500 });
    }

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

      const mappedVariants: StoreProductVariant[] = itemVariants.map(v => ({
        id: v.id,
        name: v.name,
        price: v.price,
      }));

      const priceRange = mappedVariants.length > 0
        ? {
            min: Math.min(...mappedVariants.map(v => v.price)),
            max: Math.max(...mappedVariants.map(v => v.price)),
          }
        : undefined;

      return {
        id: item.id,
        name: item.name,
        description: item.description ?? '',
        images: imageUrls,
        variants: mappedVariants.length > 0 ? mappedVariants : undefined,
        basePrice: item.basePrice,
        priceRange,
      };
    });

    return NextResponse.json({ products });
  }
  catch (error) {
    console.error('[catalog/route] Failed to load catalog:', error);
    return NextResponse.json({ error: 'Failed to load catalog' }, { status: 500 });
  }
}
