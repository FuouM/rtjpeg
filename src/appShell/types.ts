export interface RangeControlConfig {
  id: string;
  labelHtml: string;
  valueId: string;
  valueText: string;
  valueSuffixHtml?: string;
  min: string;
  max: string;
  value: string;
  step?: string;
  helpTitle: string;
  helpAriaLabel: string;
}

export interface SelectOptionConfig {
  value: string;
  label: string;
  selected?: boolean;
}

export interface SelectControlConfig {
  id: string;
  label: string;
  helpTitle: string;
  helpAriaLabel: string;
  options: SelectOptionConfig[];
}

export interface ToggleControlConfig {
  id: string;
  label: string;
  helpTitle: string;
  helpAriaLabel: string;
}
