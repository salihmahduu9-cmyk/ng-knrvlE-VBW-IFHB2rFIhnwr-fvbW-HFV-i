-- modules/watermark.lua
local Watermark = {}

function Watermark.process(code)
    return "--تم التشفير والحماية بواسطة SA | ALONE" .. code
end

return Watermark
