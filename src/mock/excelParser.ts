/**
 * 纯前端 Excel 解析 + Mock 报表生成
 * 替代后端 /api/excel/analyze 和 /api/excel/build-report
 */
import * as XLSX from 'xlsx'

// 已知字段映射表（Excel表头 → 数据源字段名）
const HEADER_MAP: Record<string, string> = {
  '城市': 'cityName',
  '门店名称': 'storeName',
  '机构编码': 'orgCode',
  '菜品名称': 'skuName',
  '菜品编码': 'skuCode',
  '菜品分类': 'skuCategory',
  '销量': 'saleCnt',
  '销售金额': 'saleAmt',
  '优惠金额': 'discountAmt',
  '销售收入': 'incomeAmt',
  '单点销量': 'singleSaleCnt',
  '单点销售额': 'singleSaleAmt',
  '关联售卖销量': 'relSaleCnt',
  '关联售卖销售额': 'relSaleAmt',
  '店内点餐': 'inStoreSaleCnt',
  '微信小程序': 'wxMiniSaleCnt',
  '抖音团购': 'douyinSaleCnt',
  '美团团购': 'meituanSaleCnt',
  '其他渠道': 'otherSaleCnt',
}

const CHANNEL_HEADERS = ['店内点餐', '微信小程序', '抖音团购', '美团团购', '其他渠道']

export interface ParsedExcel {
  headers: string[]
  rawHeaders: string[]
  mapped: Record<string, string>
  unmapped: string[]
  match_rate: number
  isChannelTemplate: boolean
  channels: string[]
}

export async function parseExcelHeaders(file: File): Promise<ParsedExcel> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' })

  const row0 = (data[0] || []) as string[]
  const row1 = (data[1] || []) as string[]

  const hasSubHeader = row1.some(v => v === '销量' || v === '销售额')

  const rawHeaders: string[] = []
  const detectedChannels: string[] = []

  if (hasSubHeader) {
    let lastParent = ''
    for (let i = 0; i < Math.max(row0.length, row1.length); i++) {
      const parent = row0[i] ? String(row0[i]).trim() : lastParent
      const child = row1[i] ? String(row1[i]).trim() : ''
      if (parent) lastParent = parent
      if (CHANNEL_HEADERS.includes(parent)) {
        if (!detectedChannels.includes(parent)) detectedChannels.push(parent)
        if (child) rawHeaders.push(`${parent}_${child}`)
        else rawHeaders.push(parent)
      } else if (child) {
        rawHeaders.push(child)
      } else if (parent) {
        rawHeaders.push(parent)
      }
    }
  } else {
    row0.forEach(v => {
      const s = String(v).trim()
      if (s) rawHeaders.push(s)
    })
  }

  const uniqueHeaders = [...new Set(rawHeaders.filter(Boolean))]

  const mapped: Record<string, string> = {}
  const unmapped: string[] = []

  uniqueHeaders.forEach(h => {
    const channelMatch = h.match(/^(.+?)_(销量|销售额)$/)
    if (channelMatch) {
      const ch = channelMatch[1]
      const metric = channelMatch[2] === '销量' ? 'SaleCnt' : 'SaleAmt'
      const chKey = ch.replace('店内点餐', 'inStore').replace('微信小程序', 'wxMini')
        .replace('抖音团购', 'douyin').replace('美团团购', 'meituan')
        .replace('其他渠道', 'other')
      mapped[h] = `${chKey}${metric}`
    } else if (HEADER_MAP[h]) {
      mapped[h] = HEADER_MAP[h]
    } else {
      unmapped.push(h)
    }
  })

  const match_rate = uniqueHeaders.length > 0
    ? Object.keys(mapped).length / uniqueHeaders.length
    : 0

  return {
    headers: uniqueHeaders.map(h => mapped[h] || h),
    rawHeaders: uniqueHeaders,
    mapped,
    unmapped,
    match_rate,
    isChannelTemplate: detectedChannels.length > 0,
    channels: detectedChannels,
  }
}

export function mockBuildReport(parsed: ParsedExcel, _userDesc: string) {
  const { isChannelTemplate, channels, rawHeaders } = parsed

  const cities = ['北京', '上海', '广州', '成都', '杭州']
  const stores = [
    ['海底捞(望京店)', 'BJ001'],
    ['西贝莜面村(三里屯店)', 'BJ002'],
    ['老乡鸡(南京西路店)', 'SH001'],
    ['外婆家(来福士店)', 'SH002'],
    ['蜀大侠(太古里店)', 'CD001'],
  ]
  const dishes: [string, string, number][] = [
    ['毛肚', '火锅食材', 68],
    ['虾滑', '火锅食材', 42],
    ['牛肉莜面', '主食', 38],
    ['招牌羊排', '主菜', 128],
    ['东坡肘子', '主菜', 98],
    ['招牌烤鱼', '主菜', 88],
    ['秘制红烧肉', '主菜', 56],
    ['青椒炒肉', '小炒', 32],
  ]

  const rows: any[][] = []

  if (isChannelTemplate) {
    dishes.forEach(([name, _cat, price], di) => {
      const store = stores[di % stores.length]
      const city = cities[di % cities.length]
      const totalQty = Math.floor(Math.random() * 200) + 50
      const totalAmt = totalQty * price
      const discAmt = Math.floor(totalAmt * 0.08)

      const channelDist: Record<string, [number, number]> = {}
      let remainQty = totalQty
      channels.forEach((ch, i) => {
        if (i === channels.length - 1) {
          channelDist[ch] = [remainQty, remainQty * price]
        } else {
          const ratio = [0.45, 0.25, 0.15, 0.10, 0.05][i] ?? 0.05
          const qty = Math.floor(totalQty * ratio)
          remainQty -= qty
          channelDist[ch] = [qty, qty * price]
        }
      })

      const row: any[] = []
      rawHeaders.forEach(h => {
        if (h === '城市') row.push(city)
        else if (h === '门店名称') row.push(store[0])
        else if (h === '机构编码') row.push(store[1])
        else if (h === '菜品名称') row.push(name)
        else if (h === '销量') row.push(totalQty)
        else if (h === '销售金额') row.push(totalAmt)
        else if (h === '优惠金额') row.push(discAmt)
        else if (h === '销售收入') row.push(totalAmt - discAmt)
        else if (h === '单点销量') row.push(Math.floor(totalQty * 0.7))
        else if (h === '单点销售额') row.push(Math.floor(totalAmt * 0.7))
        else if (h === '关联售卖销量') row.push(Math.floor(totalQty * 0.3))
        else if (h === '关联售卖销售额') row.push(Math.floor(totalAmt * 0.3))
        else {
          const m = h.match(/^(.+?)_(销量|销售额)$/)
          if (m && channelDist[m[1]]) {
            row.push(m[2] === '销量' ? channelDist[m[1]][0] : Math.floor(channelDist[m[1]][1]))
          } else {
            row.push('-')
          }
        }
      })
      rows.push(row)
    })
  } else {
    dishes.forEach(([name, cat, price], di) => {
      const store = stores[di % stores.length]
      const city = cities[di % cities.length]
      const qty = Math.floor(Math.random() * 200) + 50
      const amt = qty * price
      rows.push([city, store[0], store[1], name, cat, qty, amt, Math.floor(amt * 0.08)])
    })
  }

  const colTitle = isChannelTemplate ? '菜品销售统计（自定义渠道）' : '菜品销售统计'
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')

  return {
    type: 'data',
    report_title: `${colTitle} ${dateStr}`,
    sql: `-- Mock模式：基于Excel模板生成示例数据\nSELECT city_name, store_name, sku_name, SUM(sale_cnt), SUM(sale_amt)\nFROM dwd_dish_sale_detail\nWHERE dt = '${dateStr}'\nGROUP BY city_name, store_name, sku_name\nORDER BY sale_amt DESC`,
    columns: rawHeaders,
    rows,
    total: rows.length,
    chart_type: 'bar',
    date_hint: dateStr,
  }
}
