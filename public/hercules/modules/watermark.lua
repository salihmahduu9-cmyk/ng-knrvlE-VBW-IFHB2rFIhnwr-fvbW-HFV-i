-- modules/watermark.lua
local Watermark = {}

function Watermark.process(code)
    return "--[ SA | ALONE ]\n" .. code
end

return Watermark