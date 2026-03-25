// Mock 数据拦截器

const MOCK_REPORTS = [
  {
    id: 'r1',
    title: '每日营业额汇总',
    description: '按天统计堂食+外卖总营业额',
    sql: 'SELECT date, SUM(amount) as total FROM orders GROUP BY date ORDER BY date DESC',
    columns: ['日期', '营业额(元)'],
    rows: [['2026-03-24', 18620], ['2026-03-23', 21340], ['2026-03-22', 19870]],
    chart_type: 'line',
  },
  {
    id: 'r2',
    title: '热销菜品TOP10',
    description: '按销量排名前10的菜品',
    sql: 'SELECT dish_name, COUNT(*) as cnt FROM order_items GROUP BY dish_name ORDER BY cnt DESC LIMIT 10',
    columns: ['菜品名称', '销售份数'],
    rows: [['红烧肉', 312], ['鱼香肉丝', 289], ['宫保鸡丁', 256], ['麻婆豆腐', 234], ['糖醋里脊', 198]],
    chart_type: 'bar',
  },
]

const MOCK_DOWNLOADS = [
  {
    id: 'd1',
    report_title: '每日营业额汇总',
    file_name: '每日营业额汇总_20260324.xlsx',
    date_start: '20260317',
    date_end: '20260324',
    status: 'ready',
    created_at: Math.floor(Date.now() / 1000) - 3600,
    ready_at: Math.floor(Date.now() / 1000) - 3500,
  },
]

function mockQueryResponse(query: string) {
  const q = query.toLowerCase()
  if (q.includes('营业额') || q.includes('收入') || q.includes('金额')) {
    return {
      type: 'data',
      sql: 'SELECT dt as 日期, SUM(pay_amount) as 营业额 FROM dw_order WHERE dt >= DATE_SUB(CURDATE(),7) GROUP BY dt ORDER BY dt',
      columns: ['日期', '营业额(元)'],
      rows: [
        ['2026-03-18', 15320], ['2026-03-19', 18640], ['2026-03-20', 22100],
        ['2026-03-21', 19870], ['2026-03-22', 21340], ['2026-03-23', 18620],
        ['2026-03-24', 23580],
      ],
      total: 7,
      chart_type: 'line',
    }
  }
  if (q.includes('菜品') || q.includes('销量') || q.includes('热销')) {
    return {
      type: 'data',
      sql: 'SELECT dish_name as 菜品, COUNT(*) as 销售份数 FROM dw_order_detail GROUP BY dish_name ORDER BY 销售份数 DESC LIMIT 10',
      columns: ['菜品', '销售份数'],
      rows: [
        ['红烧肉', 312], ['鱼香肉丝', 289], ['宫保鸡丁', 256],
        ['麻婆豆腐', 234], ['糖醋里脊', 198], ['清炒时蔬', 167],
        ['白切鸡', 145], ['蒸鱼', 134], ['扬州炒饭', 128], ['皮蛋豆腐', 112],
      ],
      total: 10,
      chart_type: 'bar',
    }
  }
  if (q.includes('订单') || q.includes('单量')) {
    return {
      type: 'data',
      sql: 'SELECT dt as 日期, COUNT(*) as 订单数 FROM dw_order WHERE dt >= DATE_SUB(CURDATE(),7) GROUP BY dt ORDER BY dt',
      columns: ['日期', '订单数'],
      rows: [
        ['2026-03-18', 89], ['2026-03-19', 112], ['2026-03-20', 135],
        ['2026-03-21', 121], ['2026-03-22', 128], ['2026-03-23', 108],
        ['2026-03-24', 142],
      ],
      total: 7,
      chart_type: 'bar',
    }
  }
  if (q.includes('支付') || q.includes('付款方式')) {
    return {
      type: 'data',
      sql: 'SELECT pay_type as 支付方式, SUM(pay_amount) as 金额 FROM dw_order WHERE dt = DATE_SUB(CURDATE(),1) GROUP BY pay_type',
      columns: ['支付方式', '金额(元)'],
      rows: [['微信支付', 9840], ['支付宝', 5620], ['现金', 1230], ['美团收银', 3930]],
      total: 4,
      chart_type: 'pie',
    }
  }
  if (q.includes('优惠') || q.includes('折扣')) {
    return {
      type: 'data',
      sql: 'SELECT discount_type as 优惠类型, COUNT(*) as 使用次数, SUM(discount_amount) as 优惠金额 FROM dw_order WHERE dt >= DATE_FORMAT(CURDATE(),"%%Y-%%m-01") GROUP BY discount_type',
      columns: ['优惠类型', '使用次数', '优惠金额(元)'],
      rows: [['满减', 234, 2340], ['折扣券', 189, 1456], ['会员价', 312, 890]],
      total: 3,
      chart_type: 'bar',
    }
  }
  if (q.includes('餐段') || q.includes('午餐') || q.includes('晚餐')) {
    return {
      type: 'data',
      sql: 'SELECT meal_period as 餐段, COUNT(*) as 订单数 FROM dw_order WHERE dt = DATE_SUB(CURDATE(),1) GROUP BY meal_period',
      columns: ['餐段', '订单数'],
      rows: [['早餐', 23], ['午餐', 89], ['下午茶', 34], ['晚餐', 142]],
      total: 4,
      chart_type: 'bar',
    }
  }
  // 默认回答
  return {
    type: 'data',
    sql: `SELECT * FROM dw_order WHERE query = '${query}' LIMIT 10`,
    columns: ['日期', '数量', '金额'],
    rows: [
      ['2026-03-24', 128, 18620],
      ['2026-03-23', 115, 16340],
      ['2026-03-22', 132, 19870],
    ],
    total: 3,
    chart_type: 'bar',
  }
}

export async function mockFetch(url: string, opts?: RequestInit): Promise<any> {
  await new Promise(r => setTimeout(r, 600 + Math.random() * 800)) // 模拟网络延迟

  if (url === '/api/reports' && (!opts?.method || opts.method === 'GET')) {
    return MOCK_REPORTS
  }
  if (url === '/api/reports' && opts?.method === 'POST') {
    const body = JSON.parse(opts.body as string)
    return { id: 'r' + Date.now(), ...body, chart_type: 'bar' }
  }
  if (url === '/api/downloads') {
    return MOCK_DOWNLOADS
  }
  if (url.startsWith('/api/downloads/') && url.endsWith('/file')) {
    return new Blob(['mock excel content'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  }
  if (url === '/api/export-tasks' && opts?.method === 'POST') {
    return { id: 'task-' + Date.now(), status: 'created' }
  }
  if (url === '/api/chat/query' && opts?.method === 'POST') {
    const body = JSON.parse(opts.body as string)
    return mockQueryResponse(body.query || '')
  }
  if (url === '/api/excel/analyze' && opts?.method === 'POST') {
    return {
      headers: [
        { original: '日期', mapped: 'dt', table: 'dw_order', confidence: 0.95 },
        { original: '营业额', mapped: 'pay_amount', table: 'dw_order', confidence: 0.92 },
      ],
      mapped: [{ original: '日期', mapped: 'dt' }, { original: '营业额', mapped: 'pay_amount' }],
      unmapped: [],
      match_rate: 0.95,
      dimensions: { dimensions: [], needs_clarify: false, conflict_dims: [] },
    }
  }
  if (url === '/api/excel/build-report' && opts?.method === 'POST') {
    return {
      type: 'data',
      sql: 'SELECT dt as 日期, SUM(pay_amount) as 营业额 FROM dw_order GROUP BY dt ORDER BY dt DESC LIMIT 30',
      columns: ['日期', '营业额(元)'],
      rows: [
        ['2026-03-24', 18620], ['2026-03-23', 21340], ['2026-03-22', 19870],
        ['2026-03-21', 17650], ['2026-03-20', 22100],
      ],
      total: 5,
      chart_type: 'line',
    }
  }
  if (url === '/api/dimensions/confirm' && opts?.method === 'POST') {
    return { success: true }
  }
  if (url === '/api/dimensions/refine' && opts?.method === 'POST') {
    return { dim_name: 'mock', case_when_sql: '', categories: [], overall_confidence: 0.9, uncertain_categories: [], clarify_question: null }
  }

  return { success: true }
}
