import type { WorkspaceProblem } from '@/lib/problems/types'
import { WORKSPACE_RUBRIC } from '@/lib/problems/types'

/**
 * Refactor. Unlike every other problem here, the suite is **green from the start** —
 * the code works, it's just bad. Passing tests are the constraint, not the goal.
 *
 * All money is integer cents and every rate is integer basis points, floored. That
 * is partly realistic (float money is a bug) and partly practical: `round()` in
 * Python is banker's rounding while `Math.round` is not, so any percentage maths
 * would quietly disagree between the two languages.
 *
 * The planted smells are the ones that actually show up in review: the volume
 * discount is duplicated across all three tier branches, every rate is an unnamed
 * literal, and the shipping rule is nested when it is really one boolean.
 */
export const orderPricing: WorkspaceProblem = {
  kind: 'workspace',
  variant: 'refactor',
  slug: 'order-pricing',
  title: 'Untangle the order pricing rules',
  difficulty: 'medium',
  topics: ['refactoring', 'readability', 'business rules'],
  goal: 'The tests already pass. Improve the code without changing what it does.',
  statement: `\`price_order\` computes the price breakdown for an order. It is correct —
every test passes — and nobody wants to touch it.

Your job is to make it something you'd be happy to change next quarter, **without
altering its behaviour**. The test suite is your safety net: run it often.

**The rules it implements**

| Rule | Value |
|---|---|
| Tier discount | gold 15%, silver 10%, anything else 0% |
| Volume discount | extra 5% when subtotal > 20000 |
| Tax on the discounted amount | CA 8.75%, NY 8.5%, TX 6.25%, elsewhere 0% |
| Shipping | free for gold, or when subtotal > 10000; otherwise 999 |

All amounts are integer cents. All rates are integer basis points
(1% = 100 bp) and are **floored**, not rounded.

**What we're looking for**

Passing tests are necessary, not sufficient — they passed before you started. The
question is whether the next person can find and change a rule without re-deriving
the whole function. Be ready to explain what you changed and what you deliberately
left alone.`,
  testPath: { python: 'pricing_test.py', typescript: 'pricing.test.ts' },
  startingState: 'passing',
  files: {
    python: [
      {
        path: 'pricing.py',
        content: `def price_order(order):
    subtotal = 0
    for item in order["items"]:
        subtotal = subtotal + item["quantity"] * item["unit_price"]

    if order["customer_tier"] == "gold":
        if subtotal > 20000:
            discount = subtotal * 2000 // 10000
        else:
            discount = subtotal * 1500 // 10000
    elif order["customer_tier"] == "silver":
        if subtotal > 20000:
            discount = subtotal * 1500 // 10000
        else:
            discount = subtotal * 1000 // 10000
    else:
        if subtotal > 20000:
            discount = subtotal * 500 // 10000
        else:
            discount = 0

    if order["region"] == "CA":
        tax = (subtotal - discount) * 875 // 10000
    elif order["region"] == "NY":
        tax = (subtotal - discount) * 850 // 10000
    elif order["region"] == "TX":
        tax = (subtotal - discount) * 625 // 10000
    else:
        tax = 0

    if order["customer_tier"] == "gold":
        shipping = 0
    else:
        if subtotal > 10000:
            shipping = 0
        else:
            shipping = 999

    return {
        "subtotal": subtotal,
        "discount": discount,
        "tax": tax,
        "shipping": shipping,
        "total": subtotal - discount + tax + shipping,
    }
`,
      },
      {
        path: 'pricing_test.py',
        readOnly: true,
        content: `from pricing import price_order


def order(items, customer_tier="bronze", region="OR"):
    return {"items": items, "customer_tier": customer_tier, "region": region}


def item(quantity, unit_price):
    return {"quantity": quantity, "unit_price": unit_price}


def test_no_tier_no_tax_pays_standard_shipping():
    result = price_order(order([item(2, 2500)]))
    assert result == {
        "subtotal": 5000,
        "discount": 0,
        "tax": 0,
        "shipping": 999,
        "total": 5999,
    }


def test_gold_tier_gets_a_discount_and_free_shipping():
    result = price_order(order([item(1, 8000)], customer_tier="gold", region="CA"))
    assert result == {
        "subtotal": 8000,
        "discount": 1200,
        "tax": 595,
        "shipping": 0,
        "total": 7395,
    }


def test_silver_tier_stacks_the_volume_discount():
    result = price_order(order([item(5, 5000)], customer_tier="silver", region="NY"))
    assert result == {
        "subtotal": 25000,
        "discount": 3750,
        "tax": 1806,
        "shipping": 0,
        "total": 23056,
    }


def test_gold_tier_stacks_the_volume_discount():
    result = price_order(order([item(1, 30000)], customer_tier="gold", region="CA"))
    assert result == {
        "subtotal": 30000,
        "discount": 6000,
        "tax": 2100,
        "shipping": 0,
        "total": 26100,
    }


def test_free_shipping_above_the_threshold_without_a_tier():
    result = price_order(order([item(3, 4000)], region="TX"))
    assert result == {
        "subtotal": 12000,
        "discount": 0,
        "tax": 750,
        "shipping": 0,
        "total": 12750,
    }


def test_an_empty_order_still_pays_shipping():
    result = price_order(order([]))
    assert result == {
        "subtotal": 0,
        "discount": 0,
        "tax": 0,
        "shipping": 999,
        "total": 999,
    }
`,
      },
    ],
    typescript: [
      {
        path: 'pricing.ts',
        content: `export interface OrderItem {
  quantity: number
  unitPrice: number
}

export interface Order {
  items: OrderItem[]
  customerTier: string
  region: string
}

export interface PriceBreakdown {
  subtotal: number
  discount: number
  tax: number
  shipping: number
  total: number
}

export function priceOrder(order: Order): PriceBreakdown {
  let subtotal = 0
  for (const item of order.items) {
    subtotal = subtotal + item.quantity * item.unitPrice
  }

  let discount
  if (order.customerTier === 'gold') {
    if (subtotal > 20000) {
      discount = Math.floor((subtotal * 2000) / 10000)
    } else {
      discount = Math.floor((subtotal * 1500) / 10000)
    }
  } else if (order.customerTier === 'silver') {
    if (subtotal > 20000) {
      discount = Math.floor((subtotal * 1500) / 10000)
    } else {
      discount = Math.floor((subtotal * 1000) / 10000)
    }
  } else {
    if (subtotal > 20000) {
      discount = Math.floor((subtotal * 500) / 10000)
    } else {
      discount = 0
    }
  }

  let tax
  if (order.region === 'CA') {
    tax = Math.floor(((subtotal - discount) * 875) / 10000)
  } else if (order.region === 'NY') {
    tax = Math.floor(((subtotal - discount) * 850) / 10000)
  } else if (order.region === 'TX') {
    tax = Math.floor(((subtotal - discount) * 625) / 10000)
  } else {
    tax = 0
  }

  let shipping
  if (order.customerTier === 'gold') {
    shipping = 0
  } else {
    if (subtotal > 10000) {
      shipping = 0
    } else {
      shipping = 999
    }
  }

  return {
    subtotal,
    discount,
    tax,
    shipping,
    total: subtotal - discount + tax + shipping,
  }
}
`,
      },
      {
        path: 'pricing.test.ts',
        readOnly: true,
        content: `import { deepEqual } from 'harness'
import { priceOrder, type Order, type OrderItem } from './pricing'

function order(items: OrderItem[], customerTier = 'bronze', region = 'OR'): Order {
  return { items, customerTier, region }
}

function item(quantity: number, unitPrice: number): OrderItem {
  return { quantity, unitPrice }
}

export function testNoTierNoTaxPaysStandardShipping() {
  deepEqual(priceOrder(order([item(2, 2500)])), {
    subtotal: 5000,
    discount: 0,
    tax: 0,
    shipping: 999,
    total: 5999,
  })
}

export function testGoldTierGetsADiscountAndFreeShipping() {
  deepEqual(priceOrder(order([item(1, 8000)], 'gold', 'CA')), {
    subtotal: 8000,
    discount: 1200,
    tax: 595,
    shipping: 0,
    total: 7395,
  })
}

export function testSilverTierStacksTheVolumeDiscount() {
  deepEqual(priceOrder(order([item(5, 5000)], 'silver', 'NY')), {
    subtotal: 25000,
    discount: 3750,
    tax: 1806,
    shipping: 0,
    total: 23056,
  })
}

export function testGoldTierStacksTheVolumeDiscount() {
  deepEqual(priceOrder(order([item(1, 30000)], 'gold', 'CA')), {
    subtotal: 30000,
    discount: 6000,
    tax: 2100,
    shipping: 0,
    total: 26100,
  })
}

export function testFreeShippingAboveTheThresholdWithoutATier() {
  deepEqual(priceOrder(order([item(3, 4000)], 'bronze', 'TX')), {
    subtotal: 12000,
    discount: 0,
    tax: 750,
    shipping: 0,
    total: 12750,
  })
}

export function testAnEmptyOrderStillPaysShipping() {
  deepEqual(priceOrder(order([])), {
    subtotal: 0,
    discount: 0,
    tax: 0,
    shipping: 999,
    total: 999,
  })
}
`,
      },
    ],
  },
  referencePatch: {
    python: {
      'pricing.py': `BASIS_POINTS = 10_000

TIER_DISCOUNT_BP = {"gold": 1500, "silver": 1000}
VOLUME_DISCOUNT_BP = 500
VOLUME_THRESHOLD = 20_000

TAX_BP = {"CA": 875, "NY": 850, "TX": 625}

FREE_SHIPPING_THRESHOLD = 10_000
STANDARD_SHIPPING = 999


def _apply_rate(amount, basis_points):
    return amount * basis_points // BASIS_POINTS


def _discount_bp(customer_tier, subtotal):
    basis_points = TIER_DISCOUNT_BP.get(customer_tier, 0)
    if subtotal > VOLUME_THRESHOLD:
        basis_points += VOLUME_DISCOUNT_BP
    return basis_points


def _shipping(customer_tier, subtotal):
    qualifies = customer_tier == "gold" or subtotal > FREE_SHIPPING_THRESHOLD
    return 0 if qualifies else STANDARD_SHIPPING


def price_order(order):
    subtotal = sum(i["quantity"] * i["unit_price"] for i in order["items"])

    discount = _apply_rate(subtotal, _discount_bp(order["customer_tier"], subtotal))
    taxable = subtotal - discount
    tax = _apply_rate(taxable, TAX_BP.get(order["region"], 0))
    shipping = _shipping(order["customer_tier"], subtotal)

    return {
        "subtotal": subtotal,
        "discount": discount,
        "tax": tax,
        "shipping": shipping,
        "total": taxable + tax + shipping,
    }
`,
    },
    typescript: {
      'pricing.ts': `export interface OrderItem {
  quantity: number
  unitPrice: number
}

export interface Order {
  items: OrderItem[]
  customerTier: string
  region: string
}

export interface PriceBreakdown {
  subtotal: number
  discount: number
  tax: number
  shipping: number
  total: number
}

const BASIS_POINTS = 10_000

const TIER_DISCOUNT_BP: Record<string, number> = { gold: 1500, silver: 1000 }
const VOLUME_DISCOUNT_BP = 500
const VOLUME_THRESHOLD = 20_000

const TAX_BP: Record<string, number> = { CA: 875, NY: 850, TX: 625 }

const FREE_SHIPPING_THRESHOLD = 10_000
const STANDARD_SHIPPING = 999

const applyRate = (amount: number, basisPoints: number) =>
  Math.floor((amount * basisPoints) / BASIS_POINTS)

function discountBp(customerTier: string, subtotal: number): number {
  const tierBp = TIER_DISCOUNT_BP[customerTier] ?? 0
  return subtotal > VOLUME_THRESHOLD ? tierBp + VOLUME_DISCOUNT_BP : tierBp
}

function shippingFor(customerTier: string, subtotal: number): number {
  const qualifies = customerTier === 'gold' || subtotal > FREE_SHIPPING_THRESHOLD
  return qualifies ? 0 : STANDARD_SHIPPING
}

export function priceOrder(order: Order): PriceBreakdown {
  const subtotal = order.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)

  const discount = applyRate(subtotal, discountBp(order.customerTier, subtotal))
  const taxable = subtotal - discount
  const tax = applyRate(taxable, TAX_BP[order.region] ?? 0)
  const shipping = shippingFor(order.customerTier, subtotal)

  return { subtotal, discount, tax, shipping, total: taxable + tax + shipping }
}
`,
    },
  },
  hintLadder: [
    'Read the three discount branches side by side. What is repeated in all of them?',
    'Every rate is a bare number. What would a reader need to know to change one safely?',
    'The volume discount is really "+5% on top", not a different rule per tier.',
    'The shipping block is a single boolean condition wearing four lines of nesting.',
  ],
  followUps: [
    'What did you deliberately *not* change, and why?',
    'How would you add a fourth tier now versus before? What about a fourth tax region?',
    'The tests pin exact totals. Would you add any tests before refactoring, or are these enough?',
    'Tax is floored rather than rounded. Is that a bug? How would you find out?',
  ],
  rubric: WORKSPACE_RUBRIC.refactor,
}
