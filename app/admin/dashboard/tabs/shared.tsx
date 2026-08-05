// Small shared UI helpers for the admin dashboard tabs.

export function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block th-uppercase mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-navy-950 border border-navy-700 rounded-md px-3 py-2 text-sm text-navy-100 focus:outline-none focus:border-brand-blue"
      />
    </div>
  );
}