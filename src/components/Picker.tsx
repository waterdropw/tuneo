import React, { ReactNode } from "react"
import Colors from "@/colors"
import { MenuAction, MenuView } from "@react-native-menu/menu"
import { Appearance, Platform, StyleSheet, View } from "react-native"

export const Picker = ({
  actions,
  onSelect,
  value,
  children,
  disabled = false,
}: {
  actions: MenuAction[]
  onSelect: (id: string) => void
  value: string
  children: ReactNode
  disabled?: boolean
}) => {
  // Dark menu depends on phone settings in android
  const theme = 
    Platform.OS === "android" && Appearance.getColorScheme() === "light" ? "light" : "dark"
  const titleColor = theme === "light" ? Colors.fgLight : Colors.primary
  
  // Create a wrapper view to handle disabled state
  const wrappedChildren = React.cloneElement(children as React.ReactElement, {
    disabled,
    // 添加透明度变化，提供视觉反馈
    style: [
      (children as React.ReactElement).props.style,
      disabled && { opacity: 0.6, pointerEvents: 'none' }
    ],
  })
  
  return (
    <View style={styles.container}>
      <MenuView
        // 在disabled状态下，移除onPressAction
        onPressAction={disabled ? undefined : async ({ nativeEvent }) => {
          const id = nativeEvent.event
          onSelect(id)
        }}
        // 过滤actions，在disabled状态下不显示任何选项
        actions={disabled ? [] : actions.map(
          (a) =>
            ({
              ...a,
              state: value === a.id ? "on" : "off",
              titleColor,
              enabled: !disabled,
              subactions: a.subactions?.map((s) => ({
                ...s,
                titleColor,
                state: value === s.id ? "on" : "off",
                enabled: !disabled,
              })),
            } as MenuAction)
        )}
        themeVariant={theme}
      >
        {wrappedChildren}
      </MenuView>
      {/* 在disabled状态下添加一个覆盖层，阻止所有交互 */}
      {disabled && <View style={styles.disabledOverlay} />}
    </View>
  )
}

// 添加样式定义
const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  disabledOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    pointerEvents: 'auto',
  },
})
