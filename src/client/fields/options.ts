import type { TenderKey } from '../locales.ts'
import type { PublishPreset } from '../types.ts'

export interface FilterOption<T extends string = string> {
  readonly value: T
  readonly label: TenderKey
}

export const PUBLISH_OPTIONS: readonly FilterOption<PublishPreset>[] = [
  { value: 'all', label: 'publish.all' },
  { value: 'today', label: 'publish.today' },
  { value: '3d', label: 'publish.3d' },
  { value: '7d', label: 'publish.7d' },
  { value: '1m', label: 'publish.1m' },
  { value: '3m', label: 'publish.3m' },
  { value: '6m', label: 'publish.6m' },
  { value: '1y', label: 'publish.1y' },
  { value: '3y', label: 'publish.3y' },
  { value: '5y', label: 'publish.5y' },
  { value: 'custom', label: 'publish.custom' },
]

export const TENDER_STAGE_OPTIONS = ['预告', '招标', '变更', '澄清答疑'] as const
export const AWARD_STAGE_OPTIONS = ['开标', '中标候选', '中标成交', '合同验收', '变更', '废标流标终止'] as const
export const PROPOSED_STAGE_OPTIONS = [
  '项目核准', '项目备案', '项目建议书', '项目立项', '建设用地预审与选址意见书', '地震安全性评价',
  '环境影响报告书', '节能审查意见', '可行性研究', '初步设计及概算', '建设用地规划许可',
  '国有建设用地使用权划拨', '建设工程规划许可', '施工图审查', '工程质量监督', '施工许可',
  '竣工验收备案', '其他',
] as const
export const APPROVAL_PROGRESS_OPTIONS = ['未审批', '审批中', '审批通过', '审批未通过', '撤销', '其他'] as const

export const PROCUREMENT_OPTIONS = [
  '公开招标', '邀请招标', '询价', '竞谈', '竞磋', '竞价', '单一来源', '框架协议',
] as const
export const INDUSTRY_OPTIONS = [
  '工程建筑', '办公文教', '医疗卫生', '服务采购', '机械设备', '水利水电', '能源化工', '弱电安防',
  '信息技术', '交通运输', '市政基建', '农林牧渔', '政府部门', '日用百货', '材料配件', '通讯电子',
  '仪器仪表', '环保绿化', '服装布料', '制造生产', '家居建材', '食品饮品', '债券发行', '其他',
] as const
export const PROCUREMENT_TYPE_OPTIONS = ['工程', '货物', '服务'] as const
export const IFB_AMOUNT_OPTIONS = ['20万内', '20万-50万', '50万-100万', '100万-300万', '300万以上'] as const
export const WTB_AMOUNT_OPTIONS = ['20万内', '20万-50万', '50万-100万', '100万-300万', '300万以上'] as const
export const PROPOSED_INVESTMENT_OPTIONS = [
  '100万内', '100万-500万', '500万-1000万', '1000万-5000万', '5000万-1亿', '1亿以上',
] as const
