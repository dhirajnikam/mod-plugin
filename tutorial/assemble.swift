// Stills + one narration file per still -> H.264/AAC mp4. No ffmpeg needed.
// usage: swift assemble.swift <dir with NN.png + NN.aiff> <out.mp4>
import AVFoundation
import AppKit

let args = CommandLine.arguments
let dir = URL(fileURLWithPath: args[1]), out = URL(fileURLWithPath: args[2])
let W = 1920, H = 1080, fps: Int32 = 30
let pad = 0.5  // silence before and after each slide's narration, seconds

let fm = FileManager.default
let names = try fm.contentsOfDirectory(atPath: dir.path).filter { $0.hasSuffix(".png") }.sorted()
precondition(!names.isEmpty, "no slides")

func wait(_ body: (@escaping () -> Void) -> Void) {
  let s = DispatchSemaphore(value: 0); body { s.signal() }; s.wait()
}

// 1. silent video of the stills, each held for its narration + padding
let silent = dir.appendingPathComponent("_silent.mp4")
try? fm.removeItem(at: silent)
let writer = try AVAssetWriter(outputURL: silent, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: W, AVVideoHeightKey: H])
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
  kCVPixelBufferWidthKey as String: W, kCVPixelBufferHeightKey as String: H])
writer.add(input)
writer.startWriting(); writer.startSession(atSourceTime: .zero)

func buffer(_ url: URL) -> CVPixelBuffer {
  let img = NSImage(contentsOf: url)!.cgImage(forProposedRect: nil, context: nil, hints: nil)!
  var pb: CVPixelBuffer?
  CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &pb)
  CVPixelBufferLockBaseAddress(pb!, [])
  let ctx = CGContext(data: CVPixelBufferGetBaseAddress(pb!), width: W, height: H, bitsPerComponent: 8,
    bytesPerRow: CVPixelBufferGetBytesPerRow(pb!), space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)!
  ctx.draw(img, in: CGRect(x: 0, y: 0, width: W, height: H))
  CVPixelBufferUnlockBaseAddress(pb!, [])
  return pb!
}

var frame: Int64 = 0
var starts: [(URL, Double)] = []  // narration file, start time
for n in names {
  let audio = dir.appendingPathComponent(n.replacingOccurrences(of: ".png", with: ".aiff"))
  let secs = CMTimeGetSeconds(AVURLAsset(url: audio).duration)
  starts.append((audio, Double(frame) / Double(fps) + pad))
  let pb = buffer(dir.appendingPathComponent(n))
  for _ in 0..<Int((secs + 2 * pad) * Double(fps)) {
    while !input.isReadyForMoreMediaData { usleep(2000) }
    adaptor.append(pb, withPresentationTime: CMTime(value: frame, timescale: fps)); frame += 1
  }
}
input.markAsFinished()
wait { writer.finishWriting(completionHandler: $0) }
precondition(writer.status == .completed, "video: \(String(describing: writer.error))")

// 2. lay the narration under it and export
let comp = AVMutableComposition()
let v = AVURLAsset(url: silent)
let total = CMTime(value: frame, timescale: fps)
try comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)!
  .insertTimeRange(CMTimeRange(start: .zero, duration: total), of: v.tracks(withMediaType: .video)[0], at: .zero)
let a = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)!
for (url, at) in starts {
  let asset = AVURLAsset(url: url)
  try a.insertTimeRange(CMTimeRange(start: .zero, duration: asset.duration),
    of: asset.tracks(withMediaType: .audio)[0], at: CMTime(seconds: at, preferredTimescale: 44100))
}
try? fm.removeItem(at: out)
let export = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetHighestQuality)!
export.outputURL = out; export.outputFileType = .mp4
wait { export.exportAsynchronously(completionHandler: $0) }
precondition(export.status == .completed, "export: \(String(describing: export.error))")
try? fm.removeItem(at: silent)
print("wrote \(out.path): \(names.count) slides, \(String(format: "%.1f", CMTimeGetSeconds(total)))s")
