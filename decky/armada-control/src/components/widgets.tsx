import { ButtonItem, DropdownItem, PanelSectionRow, SliderField, ToggleField } from "@decky/ui";
import type { ReactNode } from "react";
import type { ButtonItemProps } from "@decky/ui";
import { t } from "../i18n";
import type { DropdownChoice } from "../types";

type Option = string | DropdownChoice;

export function ControlRow({ children }: { children: ReactNode }) {
  return <PanelSectionRow>{children}</PanelSectionRow>;
}

export function ButtonRow({ children, ...props }: ButtonItemProps) {
  return <ControlRow><ButtonItem {...props}>{children}</ButtonItem></ControlRow>;
}

export function SelectEdit({ label, value, options, onChange, disabled, placeholder }: {
  label?: ReactNode;
  value: any;
  options: Option[];
  onChange: (data: any) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  // Per-option disabled: shown greyed (via the option's disabled flag where the
  // Dropdown honours it) and always decorated with a cue, so an option that is
  // present-but-not-selectable (e.g. deep sleep on an unvalidated model) never
  // looks pickable. Selecting one is a no-op regardless of Dropdown support.
  const disabledData = new Set<string>();
  const rgOptions = options.map((option) => {
    const choice = typeof option === "string" ? { data: option, label: option } : option;
    if (choice.disabled) {
      disabledData.add(choice.data);
      return { ...choice, label: `${choice.label} (${t("common.unavailable")})` };
    }
    return choice;
  });
  return <ControlRow>
    <DropdownItem
      label={label}
      layout="below"
      disabled={disabled}
      strDefaultLabel={placeholder}
      selectedOption={value}
      rgOptions={rgOptions}
      onChange={(option) => {
        if (!disabledData.has(option.data)) onChange(option.data);
      }}
    />
  </ControlRow>;
}

export function ToggleRow({ label, value, onChange, disabled, description }: {
  label: ReactNode;
  value: any;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  description?: ReactNode;
}) {
  return <ControlRow>
    <ToggleField label={label} description={description} checked={!!value} disabled={disabled} onChange={onChange} />
  </ControlRow>;
}

export function SliderEdit({ label, value, min, max, step, onChange, valueSuffix, disabled, showValue = true, wrapperClassName = "armada-slider-field" }: {
  label: ReactNode;
  value: any;
  min: number;
  max: number;
  step: number;
  // Always the slider's number: the backend validates ints, so never transform it here.
  onChange: (value: number) => void;
  // Display only (e.g. "%"); does not change the value passed to onChange.
  valueSuffix?: string;
  disabled?: boolean;
  showValue?: boolean;
  wrapperClassName?: string;
}) {
  const numeric = Number(value);
  return <ControlRow>
    <SliderField
      className={wrapperClassName}
      label={label}
      childrenContainerWidth="max"
      value={Number.isFinite(numeric) ? numeric : min}
      min={min}
      max={max}
      step={step}
      showValue={showValue}
      valueSuffix={valueSuffix}
      disabled={disabled}
      onChange={(next) => onChange(next)}
    />
  </ControlRow>;
}
