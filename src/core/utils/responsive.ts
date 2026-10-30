import { Dimensions, PixelRatio } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const guidelineBaseWidth = 393;
const guidelineBaseHeight = 957;

export const RW = (size: number) => (SCREEN_WIDTH / guidelineBaseWidth) * size;

export const RH = (size: number) => (SCREEN_HEIGHT / guidelineBaseHeight) * size;

export const RF = (size: number) => {
    const scale = SCREEN_WIDTH / guidelineBaseWidth;
    return PixelRatio.roundToNearestPixel(size * scale);
};

export const RS = (size: number) => {
    const scaleWidth = SCREEN_WIDTH / guidelineBaseWidth;
    const scaleHeight = SCREEN_HEIGHT / guidelineBaseHeight;
    const scale = Math.min(scaleWidth, scaleHeight);
    return PixelRatio.roundToNearestPixel(size * scale);
};
