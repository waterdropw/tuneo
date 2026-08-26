import { createStaticNavigation } from "@react-navigation/native"
import type { StaticParamList } from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import { Settings } from "./screens/Settings"
import { Tuneo } from "./screens/Tuneo"
import { Avatar } from "./screens/Avatar"
import { AliBailianDemo } from "./screens/AliBailianDemo"
import { Companion } from "./screens/Companion"
import { BilingualTranslationDemo } from "./screens/BilingualTranslationDemo"
import Colors from "@/colors"
import { CloseButton } from "@/components/CloseButton"
import { Platform } from "react-native"

const RootStack = createNativeStackNavigator({
  initialRouteName: "Companion",
  screens: {
    Tuneo: {
      screen: Tuneo,
      options: {
        headerShown: false,
      },
    },
    Avatar: {
      screen: Avatar,
      options: {
        headerShown: false,
      },
    },
    bilingual: {
      screen: BilingualTranslationDemo,
      options: {
        title: "Bilingual Translation",
        headerTitleStyle: { color: Colors.primary },
        headerStyle: { backgroundColor: Colors.bgTitle },
        headerTintColor: Colors.primary,
        headerShadowVisible: false,
      },
    },
    demo: {
      screen: AliBailianDemo,
      options: {
        title: "Ali ASR & TTS Demo",
        headerTitleStyle: { color: Colors.primary },
        headerStyle: { backgroundColor: Colors.bgTitle },
        headerTintColor: Colors.primary,
        headerShadowVisible: false,
      },
    },
    Companion: {
      screen: Companion,
      options: {
        title: "儿童陪伴",
        headerTitleStyle: { color: Colors.primary },
        headerStyle: { backgroundColor: Colors.bgTitle },
        headerTintColor: Colors.primary,
        headerShadowVisible: false,
      },
    },
    Settings: {
      screen: Settings,
      options: () => ({
        headerTitleStyle: { color: Colors.primary },
        headerStyle: { backgroundColor: Colors.bgTitle },
        headerTintColor: Colors.primary,
        headerShadowVisible: false,
        ...(Platform.OS === "ios"
          ? { presentation: "fullScreenModal", headerRight: () => <CloseButton /> }
          : {}),
      }),
    },
  },
})

export const Navigation = createStaticNavigation(RootStack)

type RootStackParamList = StaticParamList<typeof RootStack>

declare global {
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
