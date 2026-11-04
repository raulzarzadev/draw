import AppKit
let output = CommandLine.arguments[1]
for size in [180, 192, 512] {
 let image = NSImage(size: NSSize(width: size, height: size))
 image.lockFocus()
 let scale = CGFloat(size) / 512
 let transform = NSAffineTransform()
 transform.scaleX(by: scale, yBy: scale)
 transform.concat()
 NSColor(srgbRed: 246/255, green: 247/255, blue: 249/255, alpha: 1).setFill()
 NSBezierPath(rect: NSRect(x: 0,y: 0,width: 512,height: 512)).fill()
 let dark = NSColor(srgbRed: 32/255, green: 33/255, blue: 36/255, alpha: 1)
 let accent = NSColor(srgbRed: 101/255, green: 93/255, blue: 196/255, alpha: 1)
 let d = NSBezierPath()
 d.move(to: NSPoint(x:148,y:142)); d.line(to: NSPoint(x:238,y:142))
 d.curve(to: NSPoint(x:238,y:370), controlPoint1: NSPoint(x:389,y:142), controlPoint2: NSPoint(x:389,y:370))
 d.line(to: NSPoint(x:148,y:370)); d.close(); d.lineWidth=30; d.lineJoinStyle = .round; dark.setStroke(); d.stroke()
 let line = NSBezierPath(); line.move(to:NSPoint(x:167,y:203)); line.line(to:NSPoint(x:194,y:232)); line.line(to:NSPoint(x:209,y:206)); line.line(to:NSPoint(x:234,y:221)); line.lineWidth=24; line.lineCapStyle = .round; line.lineJoinStyle = .round; accent.setStroke(); line.stroke()
 let pencil = NSBezierPath(); pencil.move(to:NSPoint(x:249,y:256)); pencil.line(to:NSPoint(x:262,y:299)); pencil.line(to:NSPoint(x:338,y:375)); pencil.line(to:NSPoint(x:368,y:345)); pencil.line(to:NSPoint(x:292,y:269)); pencil.close(); pencil.lineWidth=10; NSColor(srgbRed:246/255,green:247/255,blue:249/255,alpha:1).setStroke(); pencil.stroke(); dark.setFill(); pencil.fill()
 let cap = NSBezierPath(); cap.move(to:NSPoint(x:338,y:375)); cap.line(to:NSPoint(x:360,y:397)); cap.line(to:NSPoint(x:390,y:367)); cap.line(to:NSPoint(x:368,y:345)); cap.close(); accent.setFill(); cap.fill()
 image.unlockFocus()
 let bitmap = NSBitmapImageRep(data:image.tiffRepresentation!)!
 let rep = NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:size,pixelsHigh:size,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
 NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep:rep)
 bitmap.draw(in:NSRect(x:0,y:0,width:size,height:size)); NSGraphicsContext.restoreGraphicsState()
 try rep.representation(using:.png,properties:[:])!.write(to: URL(fileURLWithPath:"\(output)/icon-\(size).png"))
}
