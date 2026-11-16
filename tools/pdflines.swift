// Готовит PDF расписания к разбору: строки текста с координатами (lines.json)
// и картинки страниц (pN.png, масштаб SCALE) — по ним ищутся линии таблицы.
// Запуск: swift tools/pdflines.swift файл.pdf папка_вывода
import PDFKit
import AppKit

let SCALE: CGFloat = 4
let args = CommandLine.arguments
let doc = PDFDocument(url: URL(fileURLWithPath: args[1]))!
let outDir = args[2]
var out: [[String: Any]] = []
for i in 0..<doc.pageCount {
  let p = doc.page(at: i)!
  let box = p.bounds(for: .mediaBox)
  if let sel = p.selection(for: box) {
    for line in sel.selectionsByLine() {
      let b = line.bounds(for: p)
      let t = (line.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      if t.isEmpty { continue }
      out.append(["page": i, "x0": b.minX - box.minX, "y0": box.maxY - b.maxY, "x1": b.maxX - box.minX, "y1": box.maxY - b.minY, "t": t])
    }
  }
  let w = Int(box.width * SCALE), h = Int(box.height * SCALE)
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8, samplesPerPixel: 4,
                             hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  let ctx = NSGraphicsContext(bitmapImageRep: rep)!
  NSGraphicsContext.current = ctx
  NSColor.white.set(); NSRect(x: 0, y: 0, width: w, height: h).fill()
  ctx.cgContext.scaleBy(x: SCALE, y: SCALE)
  ctx.cgContext.translateBy(x: -box.minX, y: -box.minY)
  p.draw(with: .mediaBox, to: ctx.cgContext)
  NSGraphicsContext.restoreGraphicsState()
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(outDir)/p\(i + 1).png"))
}
let data = try! JSONSerialization.data(withJSONObject: ["scale": SCALE, "pages": doc.pageCount, "lines": out], options: [])
FileManager.default.createFile(atPath: "\(outDir)/lines.json", contents: data)
print("pages:", doc.pageCount, "lines:", out.count)
