<script setup lang="ts">
import { ref, watch } from "vue";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

/**
 * 第一次打开才挂载的弹出层，锚在外部按钮上。长清单每行都有几个菜单，
 * 用 PopoverTrigger 的话没打开也要挂十几个组件，切换清单会明显卡顿。
 * 按钮需自己切换 open 并标注 aria-expanded；其余属性透传给 PopoverContent。
 */
defineOptions({ inheritAttrs: false });

const open = defineModel<boolean>("open", { required: true });
const props = defineProps<{ anchor: HTMLElement | null | undefined }>();

const mounted = ref(open.value);
watch(open, (value) => {
  if (value) mounted.value = true;
});

type OutsideEvent = Event & { detail?: { originalEvent?: Event } };
// 点按钮本身交给按钮去切换，否则会先被判为外部点击关掉、再被这次点击重新打开
function onInteractOutside(event: OutsideEvent) {
  const target = (event.detail?.originalEvent?.target ?? event.target) as Node | null;
  if (target && props.anchor?.contains(target)) event.preventDefault();
}
// 没有 PopoverTrigger，关闭后手动把焦点还给按钮
function onCloseAutoFocus(event: Event) {
  event.preventDefault();
  props.anchor?.focus({ preventScroll: true });
}
</script>

<template>
  <Popover v-if="mounted" v-model:open="open">
    <PopoverAnchor v-if="anchor" :reference="anchor" />
    <PopoverContent v-bind="$attrs" @interact-outside="onInteractOutside" @close-auto-focus="onCloseAutoFocus">
      <slot />
    </PopoverContent>
  </Popover>
</template>
