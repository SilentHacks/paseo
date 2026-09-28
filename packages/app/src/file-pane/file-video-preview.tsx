import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useVideoPlayer, VideoView } from "expo-video";

export function FileVideoPreview({ uri, testID }: { uri: string; testID?: string }) {
  const player = useVideoPlayer(uri);
  return (
    <View style={styles.container} testID={testID}>
      <VideoView player={player} style={styles.video} contentFit="contain" nativeControls />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  video: {
    flex: 1,
  },
}));
