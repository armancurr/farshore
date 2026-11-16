import { type JSX, splitProps } from "solid-js";

const SIZES = {
  /* The full button, the one clear action on a card. */
  md: "h-[42px] px-4 text-sm",
  /* Tucked inside a field, at the end of an input. */
  sm: "h-[30px] px-3 text-[13px]",
};

/*
 * The solid light button. Pass `class` to size or place it, `size` for the
 * smaller one that sits inside a field.
 */
export function Button(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { size?: keyof typeof SIZES },
) {
  const [local, rest] = splitProps(props, ["class", "type", "size"]);
  return (
    <button
      type={local.type ?? "button"}
      class={`inline-flex flex-none cursor-pointer items-center justify-center gap-2 rounded-ui border border-[#d4d4d4] bg-[#f2f2f2] font-sans font-extrabold text-[#0a0a0a] transition-[background-color,scale] duration-100 select-none hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#f2f2f2] disabled:active:scale-100 ${SIZES[local.size ?? "md"]} ${local.class ?? ""}`}
      {...rest}
    />
  );
}
